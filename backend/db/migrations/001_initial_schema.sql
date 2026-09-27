CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name varchar(120) NOT NULL,
  email varchar(254) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role varchar(16) NOT NULL DEFAULT 'USER',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_full_name_not_blank
    CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  CONSTRAINT users_email_normalized
    CHECK (email = lower(btrim(email))),
  CONSTRAINT users_password_hash_not_blank
    CHECK (char_length(password_hash) > 0),
  CONSTRAINT users_role_valid
    CHECK (role IN ('USER', 'ADMIN'))
);

CREATE TABLE diagnostic_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  location text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT diagnostic_centres_name_not_blank
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT diagnostic_centres_location_not_blank
    CHECK (char_length(btrim(location)) > 0)
);

CREATE UNIQUE INDEX diagnostic_centres_name_location_unique
  ON diagnostic_centres (lower(name), lower(location));

CREATE TABLE diagnostic_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT diagnostic_tests_name_not_blank
    CHECK (char_length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX diagnostic_tests_name_unique
  ON diagnostic_tests (lower(name));

CREATE TABLE centre_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id uuid NOT NULL REFERENCES diagnostic_centres(id) ON DELETE RESTRICT,
  diagnostic_test_id uuid NOT NULL
    REFERENCES diagnostic_tests(id) ON DELETE RESTRICT,
  price_paise integer NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT centre_tests_price_positive CHECK (price_paise > 0),
  CONSTRAINT centre_tests_centre_test_unique
    UNIQUE (centre_id, diagnostic_test_id)
);

CREATE INDEX centre_tests_diagnostic_test_id_idx
  ON centre_tests (diagnostic_test_id);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  centre_test_id uuid NOT NULL REFERENCES centre_tests(id) ON DELETE RESTRICT,
  appointment_at timestamptz NOT NULL,
  amount_paise integer NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_amount_positive CHECK (amount_paise > 0),
  CONSTRAINT bookings_status_valid
    CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED'))
);

CREATE UNIQUE INDEX bookings_active_slot_unique
  ON bookings (user_id, centre_test_id, appointment_at)
  WHERE status IN ('PENDING', 'CONFIRMED');

CREATE INDEX bookings_user_created_at_idx
  ON bookings (user_id, created_at DESC);

CREATE INDEX bookings_centre_test_appointment_idx
  ON bookings (centre_test_id, appointment_at);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  provider_reference varchar(120) NOT NULL UNIQUE,
  attempt_number smallint NOT NULL,
  amount_paise integer NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_attempt_number_positive CHECK (attempt_number > 0),
  CONSTRAINT payments_amount_positive CHECK (amount_paise > 0),
  CONSTRAINT payments_status_valid
    CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  CONSTRAINT payments_booking_attempt_unique
    UNIQUE (booking_id, attempt_number)
);

CREATE UNIQUE INDEX payments_one_success_per_booking
  ON payments (booking_id)
  WHERE status = 'SUCCESS';

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id varchar(120) NOT NULL UNIQUE,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  target_status varchar(16) NOT NULL,
  payload jsonb NOT NULL,
  processing_status varchar(24) NOT NULL DEFAULT 'PENDING',
  attempt_count smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_events_target_status_valid
    CHECK (target_status IN ('SUCCESS', 'FAILED')),
  CONSTRAINT webhook_events_processing_status_valid
    CHECK (
      processing_status IN (
        'PENDING',
        'PROCESSING',
        'PROCESSED',
        'RETRY_PENDING',
        'EXHAUSTED'
      )
    ),
  CONSTRAINT webhook_events_attempt_count_non_negative
    CHECK (attempt_count >= 0),
  CONSTRAINT webhook_events_processed_at_consistent
    CHECK (
      (processing_status = 'PROCESSED' AND processed_at IS NOT NULL)
      OR (processing_status <> 'PROCESSED' AND processed_at IS NULL)
    )
);

CREATE INDEX webhook_events_payment_id_idx
  ON webhook_events (payment_id);

CREATE INDEX webhook_events_retry_queue_idx
  ON webhook_events (next_attempt_at)
  WHERE processing_status IN ('PENDING', 'RETRY_PENDING');
