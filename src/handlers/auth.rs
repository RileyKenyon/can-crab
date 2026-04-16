use std::time::{SystemTime, UNIX_EPOCH};

use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{Json, extract::State};
use jsonwebtoken::{EncodingKey, Header, encode};
use serde::{Deserialize, Serialize};

use crate::db::users;
use crate::error::AppError;
use crate::middleware::auth::Claims;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub display_name: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub token_type: String,
}

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(req.password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(e.to_string()))?
        .to_string();

    let user =
        users::create_user(&state.pool, &req.email, &password_hash, &req.display_name).await?;

    let token = make_jwt(user.id.to_string(), &state.jwt_secret)?;

    Ok(Json(AuthResponse {
        access_token: token,
        token_type: "Bearer".to_string(),
    }))
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let user = users::get_user_by_email(&state.pool, &req.email)
        .await?
        .ok_or(AppError::Unauthorized)?;

    let parsed_hash =
        PasswordHash::new(&user.password_hash).map_err(|e| AppError::Internal(e.to_string()))?;

    Argon2::default()
        .verify_password(req.password.as_bytes(), &parsed_hash)
        .map_err(|_| AppError::Unauthorized)?;

    let token = make_jwt(user.id.to_string(), &state.jwt_secret)?;

    Ok(Json(AuthResponse {
        access_token: token,
        token_type: "Bearer".to_string(),
    }))
}

fn make_jwt(user_id: String, secret: &str) -> Result<String, AppError> {
    let exp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 15 * 60; // 15 minutes

    let claims = Claims { sub: user_id, exp };
    let key = EncodingKey::from_secret(secret.as_bytes());

    encode(&Header::default(), &claims, &key)
        .map_err(|e| AppError::Internal(e.to_string()))
}
