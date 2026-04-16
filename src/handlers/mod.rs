pub mod anonymous;
pub mod auth;
pub mod datasets;
pub mod signals;

/// J1939-aware PGN key for message matching.
///
/// Strips priority bits (28-26), reserved, and data-page bits so that frames
/// with different priorities still match. For PDU1 (PF < 0xF0) the PS byte is
/// the destination address and must be ignored — two nodes exchange the same
/// PGN with swapped SA/DA, so only the PF byte identifies the message. For
/// PDU2 (PF >= 0xF0) the PS byte is a group extension and is part of the PGN.
pub fn j1939_pgn_key(raw_id: u32) -> u32 {
    let pf = (raw_id >> 16) & 0xFF;
    if pf < 0xF0 {
        raw_id & 0x00FF0000 // PDU1: PGN = PF only
    } else {
        raw_id & 0x00FFFF00 // PDU2: PGN = PF | PS
    }
}

/// Parse a candump-format log into `(timestamp, can_id, data)` tuples.
/// Format per line: `(timestamp) interface ID#hexdata`
pub fn parse_log(log: &str) -> Vec<(f64, u32, Vec<u8>)> {
    log.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 3 {
                return None;
            }
            let ts = parts[0]
                .trim_matches(|c: char| c == '(' || c == ')')
                .parse::<f64>()
                .ok()?;
            let id_data: Vec<&str> = parts[2].split('#').collect();
            if id_data.len() == 2 {
                let id = u32::from_str_radix(id_data[0], 16).ok()?;
                let data = hex_to_bytes(id_data[1])?;
                Some((ts, id, data))
            } else {
                None
            }
        })
        .collect()
}

fn hex_to_bytes(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

/// Sanitize a DBC string so that `dbc-rs` can parse it:
///
/// 1. Collapse newlines that appear inside quoted strings into spaces.
///    `dbc-rs` cannot handle multi-line `CM_` comments or other multi-line
///    quoted values.
///
/// 2. Remove `BO_` message blocks whose DLC exceeds 64 (CAN FD maximum).
///    `dbc-rs` rejects the entire file if any message violates this limit.
pub fn sanitize_dbc(dbc: &str) -> String {
    // Pass 1: collapse embedded newlines inside quoted strings.
    let mut collapsed = String::with_capacity(dbc.len());
    let mut in_string = false;
    for c in dbc.chars() {
        match c {
            '"' => {
                in_string = !in_string;
                collapsed.push(c);
            }
            '\r' if in_string => {} // drop CR inside strings
            '\n' if in_string => collapsed.push(' '),
            _ => collapsed.push(c),
        }
    }

    // Pass 2: drop BO_ blocks with DLC > 64, and drop CM_ BO_ lines.
    // CM_ BO_ comments placed before their BO_ block corrupt dbc-rs single-pass
    // state, causing VAL_ entries to fail with "non-existent signal".
    let mut out = String::with_capacity(collapsed.len());
    let mut skip_block = false;

    for line in collapsed.lines() {
        // Drop message comments and value descriptions.
        // CM_ BO_ before BO_ blocks corrupts dbc-rs single-pass state.
        // VAL_ for extended-frame (29-bit) IDs triggers a dbc-rs bug
        // ("non-existent signal"); value descriptions are not needed for decoding.
        if line.trim_start().starts_with("CM_ BO_ ")
            || line.trim_start().starts_with("VAL_ ")
        {
            continue;
        }

        if line.starts_with("BO_ ") {
            let dlc_too_large = line
                .split_whitespace()
                .nth(3)
                .and_then(|s| s.parse::<u32>().ok())
                .map(|dlc| dlc > 64)
                .unwrap_or(false);

            if dlc_too_large {
                tracing::warn!("sanitize_dbc: skipping message with DLC > 64: {}", line.trim());
                skip_block = true;
                continue;
            }
            skip_block = false;
        } else if skip_block && !line.starts_with(' ') && !line.starts_with('\t') && !line.is_empty() {
            skip_block = false;
        }

        if !skip_block {
            out.push_str(line);
            out.push('\n');
        }
    }

    out
}
