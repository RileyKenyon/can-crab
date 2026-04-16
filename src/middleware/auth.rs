use axum::{
    extract::FromRequestParts,
    http::{HeaderMap, request::Parts},
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = extract_bearer(&parts.headers).ok_or(AppError::Unauthorized)?;

        let key = DecodingKey::from_secret(state.jwt_secret.as_bytes());
        let validation = Validation::new(Algorithm::HS256);

        let data =
            decode::<Claims>(&token, &key, &validation).map_err(|_| AppError::Unauthorized)?;

        let user_id =
            Uuid::parse_str(&data.claims.sub).map_err(|_| AppError::Unauthorized)?;

        Ok(AuthUser { user_id })
    }
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    let auth = headers.get("Authorization")?.to_str().ok()?;
    auth.strip_prefix("Bearer ").map(|s| s.to_string())
}
