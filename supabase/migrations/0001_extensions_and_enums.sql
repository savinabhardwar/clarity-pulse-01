-- Extensions
create extension if not exists pgcrypto;

-- Enums
create type health_status as enum ('on_track', 'needs_attention', 'at_risk');

-- Matches Jira's real 5-tier default scheme (confirmed against live data:
-- Highest/High/Medium/Low/Lowest appear, "Critical" never does for this
-- instance but is kept for orgs with a customized priority scheme).
create type ticket_priority as enum ('critical', 'highest', 'high', 'medium', 'low', 'lowest');

create type risk_category as enum (
  'overallocated',
  'blocked_project',
  'missing_estimates',
  'stale_work',
  'dark_wip',
  'sprint_overrun'
);

create type risk_severity as enum ('high', 'medium', 'low');

create type risk_status as enum ('open', 'acknowledged', 'resolved');

create type sync_status as enum ('running', 'success', 'partial', 'failed');

create type activity_kind as enum ('released', 'completed', 'blocked', 'qa', 'merged', 'update');
