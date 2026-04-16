use std::collections::HashMap;

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::Dataset;

pub async fn create_dataset(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    dbc_content: &str,
    log_filename: &str,
    dbc_filename: &str,
) -> Result<Dataset, AppError> {
    let dataset = sqlx::query_as::<_, Dataset>(
        "INSERT INTO datasets (user_id, name, dbc_content, log_filename, dbc_filename)
         VALUES ($1, $2, $3, $4, $5) RETURNING *",
    )
    .bind(user_id)
    .bind(name)
    .bind(dbc_content)
    .bind(log_filename)
    .bind(dbc_filename)
    .fetch_one(pool)
    .await?;
    Ok(dataset)
}

pub async fn list_datasets_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<Dataset>, AppError> {
    let datasets = sqlx::query_as::<_, Dataset>(
        "SELECT * FROM datasets WHERE user_id = $1 ORDER BY created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(datasets)
}

pub async fn get_dataset(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Option<Dataset>, AppError> {
    let dataset = sqlx::query_as::<_, Dataset>(
        "SELECT * FROM datasets WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(dataset)
}

#[allow(clippy::too_many_arguments)]
pub async fn update_dataset_status(
    pool: &PgPool,
    id: Uuid,
    status: &str,
    error_message: Option<&str>,
    frame_count: Option<i64>,
    signal_sample_count: Option<i64>,
    recording_start: Option<f64>,
    recording_end: Option<f64>,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE datasets SET
            status = $2,
            error_message = $3,
            frame_count = COALESCE($4, frame_count),
            signal_sample_count = COALESCE($5, signal_sample_count),
            recording_start = COALESCE($6, recording_start),
            recording_end = COALESCE($7, recording_end)
         WHERE id = $1",
    )
    .bind(id)
    .bind(status)
    .bind(error_message)
    .bind(frame_count)
    .bind(signal_sample_count)
    .bind(recording_start)
    .bind(recording_end)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_dataset(pool: &PgPool, id: Uuid, user_id: Uuid) -> Result<bool, AppError> {
    let result = sqlx::query("DELETE FROM datasets WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn rename_dataset(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    name: &str,
) -> Result<Option<Dataset>, AppError> {
    let dataset = sqlx::query_as::<_, Dataset>(
        "UPDATE datasets SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING *",
    )
    .bind(id)
    .bind(user_id)
    .bind(name)
    .fetch_optional(pool)
    .await?;
    Ok(dataset)
}

pub async fn bulk_insert_can_frames(
    pool: &PgPool,
    dataset_id: Uuid,
    frames: &[(f64, u32, Vec<u8>)],
) -> Result<i64, AppError> {
    let mut total = 0i64;
    for chunk in frames.chunks(1000) {
        let mut qb = sqlx::QueryBuilder::new(
            "INSERT INTO can_frames (dataset_id, timestamp_s, frame_id, frame_data) ",
        );
        qb.push_values(chunk, |mut b, (ts, id, data)| {
            b.push_bind(dataset_id)
                .push_bind(*ts)
                .push_bind(*id as i64)
                .push_bind(data.as_slice());
        });
        let result = qb.build().execute(pool).await?;
        total += result.rows_affected() as i64;
    }
    Ok(total)
}

pub async fn bulk_insert_signals(
    pool: &PgPool,
    dataset_id: Uuid,
    signal_map: &HashMap<String, Vec<(f64, f64)>>,
) -> Result<i64, AppError> {
    let mut total = 0i64;
    for (signal_name, samples) in signal_map {
        for chunk in samples.chunks(1000) {
            let mut qb = sqlx::QueryBuilder::new(
                "INSERT INTO signal_samples (dataset_id, signal_name, timestamp_s, value) ",
            );
            qb.push_values(chunk, |mut b, (ts, val)| {
                b.push_bind(dataset_id)
                    .push_bind(signal_name.as_str())
                    .push_bind(*ts)
                    .push_bind(*val);
            });
            let result = qb.build().execute(pool).await?;
            total += result.rows_affected() as i64;
        }
    }
    Ok(total)
}

pub async fn insert_dataset_signals(
    pool: &PgPool,
    dataset_id: Uuid,
    signal_map: &HashMap<String, Vec<(f64, f64)>>,
) -> Result<(), AppError> {
    for (signal_name, samples) in signal_map {
        if samples.is_empty() {
            continue;
        }
        let values: Vec<f64> = samples.iter().map(|(_, v)| *v).collect();
        let min = values.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let mean = values.iter().sum::<f64>() / values.len() as f64;
        let count = samples.len() as i64;

        sqlx::query(
            "INSERT INTO dataset_signals
                (dataset_id, signal_name, sample_count, value_min, value_max, value_mean)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (dataset_id, signal_name) DO UPDATE SET
                sample_count = $3, value_min = $4, value_max = $5, value_mean = $6",
        )
        .bind(dataset_id)
        .bind(signal_name.as_str())
        .bind(count)
        .bind(min)
        .bind(max)
        .bind(mean)
        .execute(pool)
        .await?;
    }
    Ok(())
}

