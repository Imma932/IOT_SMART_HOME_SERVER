CREATE DATABASE IF NOT EXISTS SmartHome
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE SmartHome;

CREATE TABLE IF NOT EXISTS gender (
    gender_id INT PRIMARY KEY,
    gender VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO gender (gender_id, gender)
VALUES
    (1, 'Male'),
    (2, 'Female'),
    (3, 'Non-binary'),
    (4, 'Unspecified')
ON DUPLICATE KEY UPDATE gender = VALUES(gender);

CREATE TABLE IF NOT EXISTS users (
    username VARCHAR(50) PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    fname VARCHAR(50) NULL,
    lname VARCHAR(50) NULL,
    gender_id INT NULL,
    location VARCHAR(100) NULL,
    phone_number VARCHAR(20) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_gender FOREIGN KEY (gender_id)
        REFERENCES gender(gender_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS microcontroller (
    username VARCHAR(50) NOT NULL,
    device_mac_address VARCHAR(17) PRIMARY KEY,
    device_name VARCHAR(100) NOT NULL DEFAULT 'My ESP32 Room Controller',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_microcontroller_user FOREIGN KEY (username)
        REFERENCES users(username)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_microcontroller_username
    ON microcontroller (username);

CREATE TABLE IF NOT EXISTS telemetry (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    temperature DECIMAL(5,2) NOT NULL,
    humidity DECIMAL(5,2) NOT NULL,
    light_status ENUM('ON', 'OFF') NOT NULL DEFAULT 'OFF',
    device_mac_address VARCHAR(17) NOT NULL,
    version INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_telemetry_device FOREIGN KEY (device_mac_address)
        REFERENCES microcontroller(device_mac_address)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_telemetry_device_created
    ON telemetry (device_mac_address, created_at);
