use std::collections::HashMap;

use axum::{
    Json,
    extract::{Multipart, Path, State},
    http::StatusCode,
};
use dbc_rs::Dbc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::datasets as ds_db;
use crate::error::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::Dataset;
use crate::state::AppState;

#[derive(Serialize)]
pub struct CreateDatasetResponse {
    pub dataset_id: Uuid,
    pub status: String,
}

#[derive(Deserialize)]
pub struct RenameRequest {
    pub name: String,
}

#[derive(Serialize)]
pub struct DatasetStatus {
    pub status: String,
    pub error_message: Option<String>,
}

pub async fn list_datasets(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<Dataset>>, AppError> {
    let ds = ds_db::list_datasets_for_user(&state.pool, auth.user_id).await?;
    Ok(Json(ds))
}

pub async fn create_dataset(
    auth: AuthUser,
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<CreateDatasetResponse>), AppError> {
    tracing::info!(user_id = %auth.user_id, "create_dataset: request received");
    let mut dbc_content: Option<String> = None;
    let mut log_content: Option<String> = None;
    let mut dbc_filename = "upload.dbc".to_string();
    let mut log_filename = "upload.log".to_string();
    let mut name: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| {
            tracing::error!("create_dataset: next_field error: {e}");
            AppError::BadRequest(e.to_string())
        })?
    {
        let field_name = field.name().unwrap_or("").to_string();
        let fname = field.file_name().unwrap_or("").to_string();
        tracing::info!("create_dataset: reading field '{field_name}' (filename='{fname}')");
        let data = field
            .bytes()
            .await
            .map_err(|e| {
                tracing::error!("create_dataset: bytes() error on field '{field_name}': {e}");
                AppError::BadRequest(e.to_string())
            })?;
        tracing::info!("create_dataset: field '{field_name}' read ({} bytes)", data.len());

        match field_name.as_str() {
            "dbc" => {
                if !fname.is_empty() {
                    dbc_filename = fname;
                }
                if std::str::from_utf8(&data).is_err() {
                    tracing::warn!("create_dataset: DBC contains non-UTF-8 bytes, decoding as Latin-1");
                }
                dbc_content = Some(data.iter().map(|&b| b as char).collect::<String>());
            }
            "log" => {
                if !fname.is_empty() {
                    log_filename = fname.clone();
                }
                if std::str::from_utf8(&data).is_err() {
                    tracing::warn!("create_dataset: log contains non-UTF-8 bytes, decoding as Latin-1");
                }
                log_content = Some(data.iter().map(|&b| b as char).collect::<String>());
            }
            "name" => {
                name = Some(String::from_utf8(data.to_vec()).unwrap_or_default());
            }
            _ => {}
        }
    }

    let dbc_str =
        dbc_content.ok_or_else(|| AppError::BadRequest("Missing DBC file".into()))?;
    let log_str =
        log_content.ok_or_else(|| AppError::BadRequest("Missing log file".into()))?;
    let dataset_name = name.unwrap_or_else(|| {
        log_filename
            .trim_end_matches(".log")
            .trim_end_matches(".txt")
            .to_string()
    });

    let dataset = ds_db::create_dataset(
        &state.pool,
        auth.user_id,
        &dataset_name,
        &dbc_str,
        &log_filename,
        &dbc_filename,
    )
    .await?;

    let dataset_id = dataset.id;
    let pool = state.pool.clone();

    tokio::spawn(async move {
        process_dataset(pool, dataset_id, dbc_str, log_str).await;
    });

    Ok((
        StatusCode::ACCEPTED,
        Json(CreateDatasetResponse {
            dataset_id,
            status: "pending".to_string(),
        }),
    ))
}

async fn process_dataset(pool: sqlx::PgPool, dataset_id: Uuid, dbc_str: String, log_str: String) {
    let result: Result<(), AppError> = async {
        ds_db::update_dataset_status(
            &pool, dataset_id, "processing", None, None, None, None, None,
        )
        .await?;

        let dbc_str = crate::handlers::sanitize_dbc(&dbc_str);
        let dbc = Dbc::parse(&dbc_str)
            .map_err(|e| AppError::BadRequest(format!("DBC parse error: {:?}", e)))?;

        let frames = crate::handlers::parse_log(&log_str);
        let frame_count = frames.len() as i64;

        ds_db::bulk_insert_can_frames(&pool, dataset_id, &frames).await?;

        let mut signal_map: HashMap<String, Vec<(f64, f64)>> = HashMap::new();
        let mut signal_messages: HashMap<String, String> = HashMap::new();
        for (ts, id, data) in &frames {
            if let Some(message) = dbc.messages().iter().find(|m| crate::handlers::j1939_pgn_key(m.id()) == crate::handlers::j1939_pgn_key(*id)) {
                let msg_name = message.name().to_string();
                let signals = message.signals();
                let mut values = vec![0.0f64; signals.len()];
                let num_decoded = message.decode_into(data, &mut values);
                for (i, val) in values.iter().enumerate().take(num_decoded) {
                    if let Some(signal) = signals.iter().nth(i) {
                        let sig_name = signal.name().to_string();
                        signal_messages.entry(sig_name.clone()).or_insert_with(|| msg_name.clone());
                        signal_map
                            .entry(sig_name)
                            .or_default()
                            .push((*ts, *val));
                    }
                }
            }
        }

        let signal_sample_count =
            ds_db::bulk_insert_signals(&pool, dataset_id, &signal_map).await?;
        ds_db::insert_dataset_signals(&pool, dataset_id, &signal_map, &signal_messages).await?;

        let (recording_start, recording_end) = if frames.is_empty() {
            (None, None)
        } else {
            let start = frames.iter().map(|(ts, _, _)| *ts).fold(f64::INFINITY, f64::min);
            let end = frames
                .iter()
                .map(|(ts, _, _)| *ts)
                .fold(f64::NEG_INFINITY, f64::max);
            (Some(start), Some(end))
        };

        ds_db::update_dataset_status(
            &pool,
            dataset_id,
            "ready",
            None,
            Some(frame_count),
            Some(signal_sample_count),
            recording_start,
            recording_end,
        )
        .await?;

        Ok(())
    }
    .await;

    if let Err(e) = result {
        let _ = ds_db::update_dataset_status(
            &pool,
            dataset_id,
            "failed",
            Some(&e.to_string()),
            None,
            None,
            None,
            None,
        )
        .await;
    }
}


pub async fn get_dataset(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Dataset>, AppError> {
    let ds = ds_db::get_dataset(&state.pool, id, auth.user_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(ds))
}

pub async fn get_dataset_status(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<DatasetStatus>, AppError> {
    let ds = ds_db::get_dataset(&state.pool, id, auth.user_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(DatasetStatus {
        status: ds.status,
        error_message: ds.error_message,
    }))
}

pub async fn delete_dataset(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let deleted = ds_db::delete_dataset(&state.pool, id, auth.user_id).await?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound)
    }
}

pub async fn rename_dataset_handler(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<RenameRequest>,
) -> Result<Json<Dataset>, AppError> {
    let ds = ds_db::rename_dataset(&state.pool, id, auth.user_id, &req.name)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(ds))
}
