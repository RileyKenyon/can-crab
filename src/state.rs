use std::sync::Arc;

use dbc_rs::Dbc;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnonCanMessage {
    pub timestamp: f64,
    pub id: u32,
    pub data: Vec<u8>,
}

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt_secret: String,
    /// In-memory state for anonymous (unauthenticated) uploads.
    pub anon_dbc: Arc<Mutex<Option<Dbc>>>,
    pub anon_log: Arc<Mutex<Vec<AnonCanMessage>>>,
}
