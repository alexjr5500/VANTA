-- Migration: Remove the VANTA Give fundraising system
-- Drops every Fundraiser-* table (children first, then parents) that was
-- created by 20260830000000_give_fundraising. The feature is fully removed
-- from the application; no table retains a foreign key to these tables.

DROP TABLE IF EXISTS "FundraiserAuditLog";
DROP TABLE IF EXISTS "FundraiserReport";
DROP TABLE IF EXISTS "FundraiserDonation";
DROP TABLE IF EXISTS "FundraiserUpdate";
DROP TABLE IF EXISTS "FundraiserEvidence";
DROP TABLE IF EXISTS "FundraiserMedia";
DROP TABLE IF EXISTS "Fundraiser";
DROP TABLE IF EXISTS "FundraiserCategory";