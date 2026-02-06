-- init-postgres.sql
-- Create application database
CREATE DATABASE backstage;
-- Create ZITADEL database
CREATE DATABASE zitadel;

-- Create users if they don't exist (optional as docker-compose handles default)
-- CREATE USER backstage WITH PASSWORD 'backstage';
-- GRANT ALL PRIVILEGES ON DATABASE backstage TO backstage;
