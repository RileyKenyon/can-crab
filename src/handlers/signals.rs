use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::signals as signals_db;
use crate::error::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::DatasetSignal;
use crate::state::AppState;

pub async fn list_signals(
    _auth: AuthUser,
    State(state): State<AppState>,
    Path(dataset_id): Path<Uuid>,
) -> Result<Json<Vec<DatasetSignal>>, AppError> {
    let signals = signals_db::list_signals(&state.pool, dataset_id).await?;
    Ok(Json(signals))
}

#[derive(Deserialize)]
pub struct SignalQuery {
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub points: Option<i64>,
}

#[derive(Serialize)]
pub struct SignalTimeSeriesResponse {
    pub name: String,
    pub timestamps: Vec<f64>,
    pub values: Vec<f64>,
}

pub async fn get_signal(
    _auth: AuthUser,
    State(state): State<AppState>,
    Path((dataset_id, signal_name)): Path<(Uuid, String)>,
    Query(query): Query<SignalQuery>,
) -> Result<Json<SignalTimeSeriesResponse>, AppError> {
    let samples = signals_db::get_signal_samples(
        &state.pool,
        dataset_id,
        &signal_name,
        query.start,
        query.end,
        query.points,
    )
    .await?;

    let timestamps: Vec<f64> = samples.iter().map(|s| s.timestamp_s).collect();
    let values: Vec<f64> = samples.iter().map(|s| s.value).collect();

    Ok(Json(SignalTimeSeriesResponse {
        name: signal_name,
        timestamps,
        values,
    }))
}
