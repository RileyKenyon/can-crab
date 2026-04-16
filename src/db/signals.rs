use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::{DatasetSignal, SignalSample};

pub async fn list_signals(
    pool: &PgPool,
    dataset_id: Uuid,
) -> Result<Vec<DatasetSignal>, AppError> {
    let signals = sqlx::query_as::<_, DatasetSignal>(
        "SELECT * FROM dataset_signals WHERE dataset_id = $1 ORDER BY signal_name",
    )
    .bind(dataset_id)
    .fetch_all(pool)
    .await?;
    Ok(signals)
}

pub async fn get_signal_samples(
    pool: &PgPool,
    dataset_id: Uuid,
    signal_name: &str,
    start: Option<f64>,
    end: Option<f64>,
    max_points: Option<i64>,
) -> Result<Vec<SignalSample>, AppError> {
    let t_start = start.unwrap_or(f64::NEG_INFINITY);
    let t_end = end.unwrap_or(f64::INFINITY);
    let max_pts = max_points.unwrap_or(2000);

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM signal_samples
         WHERE dataset_id = $1 AND signal_name = $2
           AND timestamp_s BETWEEN $3 AND $4",
    )
    .bind(dataset_id)
    .bind(signal_name)
    .bind(t_start)
    .bind(t_end)
    .fetch_one(pool)
    .await?;

    if count <= max_pts {
        let samples = sqlx::query_as::<_, SignalSample>(
            "SELECT timestamp_s, value FROM signal_samples
             WHERE dataset_id = $1 AND signal_name = $2
               AND timestamp_s BETWEEN $3 AND $4
             ORDER BY timestamp_s",
        )
        .bind(dataset_id)
        .bind(signal_name)
        .bind(t_start)
        .bind(t_end)
        .fetch_all(pool)
        .await?;
        Ok(samples)
    } else {
        // Downsample: bucket by equal-width time intervals, return avg per bucket
        let samples = sqlx::query_as::<_, SignalSample>(
            "SELECT
                AVG(timestamp_s)::float8 AS timestamp_s,
                AVG(value)::float8 AS value
             FROM signal_samples
             WHERE dataset_id = $1 AND signal_name = $2
               AND timestamp_s BETWEEN $3 AND $4
             GROUP BY width_bucket(timestamp_s, $3::float8, $4::float8 + 1e-9, $5::int)
             ORDER BY 1",
        )
        .bind(dataset_id)
        .bind(signal_name)
        .bind(t_start)
        .bind(t_end)
        .bind(max_pts as i32)
        .fetch_all(pool)
        .await?;
        Ok(samples)
    }
}
