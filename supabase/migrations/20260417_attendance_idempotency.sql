-- 20260417_attendance_idempotency.sql
-- Idempotency key for attendance_events so re-posts from the tracker / Apps
-- Script never create duplicate LOGIN/LOGOUT rows for the same pilot-minute.

create unique index if not exists ux_attendance_minute_key
  on attendance_events (pilot_uuid, event_type, date_trunc('minute', event_ts));
