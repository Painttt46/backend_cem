-- Add fuel level columns to car_bookings table
ALTER TABLE car_bookings ADD COLUMN IF NOT EXISTS fuel_level_borrow INTEGER;
ALTER TABLE car_bookings ADD COLUMN IF NOT EXISTS fuel_level_return INTEGER;
