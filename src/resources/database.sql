-- Create the gender table
CREATE TABLE IF NOT EXISTS gender (
    gender_id INT PRIMARY KEY,
    gender VARCHAR(50) NOT NULL UNIQUE
);

-- Insert genders (PostgreSQL version of ON DUPLICATE KEY UPDATE)
INSERT INTO gender (gender_id, gender)
VALUES
    (1, 'Male'),
    (2, 'Female'),
    (3, 'Non-binary'),
    (4, 'Unspecified')
ON CONFLICT (gender_id) 
DO UPDATE SET gender = EXCLUDED.gender;

-- Create the users table
CREATE TABLE IF NOT EXISTS users (
    username VARCHAR(50) PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    fname VARCHAR(50),
    lname VARCHAR(50),
    gender_id INT,
    location VARCHAR(100),
    phone_number VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_gender FOREIGN KEY (gender_id)
        REFERENCES gender(gender_id)
);

-- PostgreSQL doesn't support "ON UPDATE CURRENT_TIMESTAMP" automatically.
-- We need a function and a trigger to replicate this behavior:

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
