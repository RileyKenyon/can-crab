use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{get, post},
};
use dotenvy::dotenv;
use std::env;
use tower_http::services::ServeDir;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use cancrab::{
    db,
    handlers::{
        anonymous as anon_handlers, auth as auth_handlers,
        datasets as dataset_handlers, signals as signal_handlers,
    },
    state::AppState,
};

const MAX_UPLOAD_SIZE: usize = 256 * 1024 * 1024; // 256 MB

#[tokio::main]
async fn main() {
    dotenv().ok();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::new(
                env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()),
            ),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let jwt_secret = env::var("JWT_SECRET")
        .unwrap_or_else(|_| "changeme-insecure-jwt-secret".to_string());

    let pool = db::create_pool(&database_url)
        .await
        .expect("Failed to connect to database");

    db::run_migrations(&pool)
        .await
        .expect("Failed to run migrations");

    tracing::info!("Database migrations applied");

    let state = AppState {
        pool,
        jwt_secret,
        anon_dbc: std::sync::Arc::new(tokio::sync::Mutex::new(None)),
        anon_log: std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new())),
    };

    let api = Router::new()
        // Anonymous (no auth required)
        .route("/upload", post(anon_handlers::upload))
        .route("/data", get(anon_handlers::get_data))
        // Auth
        .route("/auth/register", post(auth_handlers::register))
        .route("/auth/login", post(auth_handlers::login))
        // Datasets
        .route(
            "/datasets",
            get(dataset_handlers::list_datasets).post(dataset_handlers::create_dataset),
        )
        .route(
            "/datasets/{id}",
            get(dataset_handlers::get_dataset)
                .delete(dataset_handlers::delete_dataset)
                .patch(dataset_handlers::rename_dataset_handler),
        )
        .route(
            "/datasets/{id}/status",
            get(dataset_handlers::get_dataset_status),
        )
        // Signals
        .route(
            "/datasets/{id}/signals",
            get(signal_handlers::list_signals),
        )
        .route(
            "/datasets/{id}/signals/{name}",
            get(signal_handlers::get_signal),
        )
        .with_state(state);

    let app = Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new("static"))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_SIZE));

    let addr = env::var("SERVER_ADDR").unwrap_or_else(|_| "0.0.0.0:8081".to_string());
    tracing::info!("Server running on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
