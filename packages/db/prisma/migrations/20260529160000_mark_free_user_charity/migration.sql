UPDATE "User"
SET
  "charityEnabled" = true,
  "charityDisplayName" = COALESCE(NULLIF(TRIM("charityDisplayName"), ''), 'APIshare Free'),
  "charityIpRateLimitEnabled" = true,
  "charityIpRateLimitPerMinute" = CASE
    WHEN "charityIpRateLimitPerMinute" > 0 THEN "charityIpRateLimitPerMinute"
    ELSE 3
  END
WHERE lower("email") = 'free@qq.com';
