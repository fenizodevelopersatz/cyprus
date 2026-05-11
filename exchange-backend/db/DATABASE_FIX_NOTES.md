# Database Schema Issue Fix

## Problem
The error "Unknown column 'username' in 'where clause'" occurs when trying to update a user profile with a username. This happens because:

1. The `user_profiles` table was created in migration `000_init_core.js` with only basic columns (`user_id`, `display_name`, `country`, `tier`, `last_login`)
2. Migration `030_user_profile_personal_info.js` attempts to add the missing columns including `username`, `first_name`, `last_name`, etc.
3. If that migration hasn't been run, or was skipped due to table existence checks, the columns don't exist in the database
4. When the code tries to query the `username` column in `userService.js`, it fails

## Solution

### 1. Updated `024_admin_control_settings.js`
Added existence checks for all tables before creating them to prevent "table already exists" errors:
- Check if `admin_trading_rules` table exists before creating
- Check if `admin_trade_time_slots` table exists before creating
- Check if `admin_package_tier_settings` table exists before creating
- Check if `admin_birthday_gift_settings` table exists before creating

### 2. Created `032_fix_user_profiles_columns.js`
A new migration that ensures all necessary columns exist in the `user_profiles` table:
- Checks for each column using `knex.schema.hasColumn()`
- Only adds columns that don't exist
- Handles errors gracefully to continue adding other columns if one fails
- Provides a down() function to reverse the changes if needed

### 3. Updated `userService.js`
Modified the username uniqueness check to be more robust:
- Check if the `username` column exists before querying
- Wrap the query in a try-catch to handle any "Unknown column" errors gracefully
- If the column doesn't exist, skip the uniqueness check (will be re-evaluated once migration runs)
- Store the username value regardless of whether the check succeeds

## How to Apply

1. Run the database migrations:
```bash
npm run migrate
```

2. If you get rollback errors, you may need to manually fix the database:
   - Drop or fix problematic tables that were partially created
   - Run the migrate command again

3. The code will now:
   - Safely handle missing columns
   - Add missing columns through the new migration
   - Allow username updates to work once the columns are properly created

## Column Schema
The following columns are now properly added to `user_profiles`:
- `first_name` (varchar 120)
- `last_name` (varchar 120)
- `username` (varchar 120, UNIQUE, NULLABLE)
- `mobile_number` (varchar 40)
- `state` (varchar 120)
- `city` (varchar 120)
- `postal_code` (varchar 40)
- `date_of_birth` (DATE)
- `gender` (varchar 40)
- `address_line_1` (varchar 255)
- `address_line_2` (varchar 255)
- `profile_photo` (TEXT)

## Testing
After applying migrations, test the profile update endpoint with username:
```
PATCH /api/user/profile
{
  "username": "testuser123",
  ...
}
```

Should return the updated profile without the "Unknown column" error.
