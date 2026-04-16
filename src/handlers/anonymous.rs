use std::collections::HashMap;

use axum::{Json, extract::{Multipart, State}, http::StatusCode};
use dbc_rs::Dbc;
use serde::Serialize;

use crate::state::{AnonCanMessage, AppState};

#[derive(Serialize)]
pub struct SignalData {
    pub name: String,
    pub timestamps: Vec<f64>,
    pub values: Vec<f64>,
}

pub async fn upload(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<StatusCode, StatusCode> {
    tracing::info!("anon upload: request received");
    let mut dbc_content: Option<String> = None;
    let mut log_content: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::error!("anon upload: next_field error: {e}");
        StatusCode::BAD_REQUEST
    })? {
        let name = field.name().unwrap_or("").to_string();
        tracing::info!("anon upload: reading field '{name}'");
        let data = field.bytes().await.map_err(|e| {
            tracing::error!("anon upload: bytes() error on field '{name}': {e}");
            StatusCode::BAD_REQUEST
        })?;
        tracing::info!("anon upload: field '{name}' read ({} bytes)", data.len());
        match name.as_str() {
            "dbc" => {
                if std::str::from_utf8(&data).is_err() {
                    tracing::warn!("anon upload: DBC contains non-UTF-8 bytes, decoding as Latin-1");
                }
                dbc_content = Some(data.iter().map(|&b| b as char).collect::<String>());
            }
            "log" => {
                if std::str::from_utf8(&data).is_err() {
                    tracing::warn!("anon upload: log contains non-UTF-8 bytes, decoding as Latin-1");
                }
                log_content = Some(data.iter().map(|&b| b as char).collect::<String>());
            }
            _ => {}
        }
    }

    match (dbc_content, log_content) {
        (Some(dbc_str), Some(log_str)) => {
            tracing::info!("anon upload: parsing DBC");
            let dbc_str = crate::handlers::sanitize_dbc(&dbc_str);
            let dbc = Dbc::parse(&dbc_str).map_err(|e| {
                tracing::error!("anon upload: DBC parse error: {e:?}");
                StatusCode::BAD_REQUEST
            })?;
            let messages = crate::handlers::parse_log(&log_str)
            .into_iter()
            .map(|(timestamp, id, data)| AnonCanMessage { timestamp, id, data })
            .collect::<Vec<_>>();
            tracing::info!("anon upload: parsed {} CAN frames, storing", messages.len());
            *state.anon_dbc.lock().await = Some(dbc);
            *state.anon_log.lock().await = messages;
            Ok(StatusCode::OK)
        }
        (dbc, log) => {
            tracing::error!("anon upload: missing files — dbc={} log={}", dbc.is_some(), log.is_some());
            Err(StatusCode::BAD_REQUEST)
        }
    }
}

pub async fn get_data(
    State(state): State<AppState>,
) -> Result<Json<Vec<SignalData>>, StatusCode> {
    let dbc = state.anon_dbc.lock().await.clone().ok_or(StatusCode::BAD_REQUEST)?;
    let messages = state.anon_log.lock().await.clone();

    let mut signal_map: HashMap<String, Vec<(f64, f64)>> = HashMap::new();
    for msg in messages {
        if let Some(message) = dbc.messages().iter().find(|m| crate::handlers::j1939_pgn_key(m.id()) == crate::handlers::j1939_pgn_key(msg.id)) {
            let signals = message.signals();
            let mut values = vec![0.0f64; signals.len()];
            let num_decoded = message.decode_into(&msg.data, &mut values);
            for (i, val) in values.iter().enumerate().take(num_decoded) {
                if let Some(signal) = signals.iter().nth(i) {
                    signal_map
                        .entry(signal.name().to_string())
                        .or_default()
                        .push((msg.timestamp, *val));
                }
            }
        }
    }

    let signals = signal_map
        .into_iter()
        .map(|(name, data)| SignalData {
            name,
            timestamps: data.iter().map(|(t, _)| *t).collect(),
            values: data.iter().map(|(_, v)| *v).collect(),
        })
        .collect();

    Ok(Json(signals))
}

