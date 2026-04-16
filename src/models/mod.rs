use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Dataset {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    #[serde(skip_serializing)]
    pub dbc_content: String,
    pub log_filename: String,
    pub dbc_filename: String,
    pub recording_start: Option<f64>,
    pub recording_end: Option<f64>,
    pub frame_count: i64,
    pub signal_sample_count: i64,
    pub status: String,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct DatasetSignal {
    pub id: Uuid,
    pub dataset_id: Uuid,
    pub signal_name: String,
    pub unit: Option<String>,
    pub sample_count: i64,
    pub value_min: Option<f64>,
    pub value_max: Option<f64>,
    pub value_mean: Option<f64>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct SignalSample {
    pub timestamp_s: f64,
    pub value: f64,
}
