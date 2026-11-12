import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("task execution lease migration", () => {
  const migrationPath = path.join(process.cwd(), "supabase", "migrations", "0010_task_execution_leases.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");

  it("adds lease and fencing fields", () => {
    expect(sql).toContain("add column if not exists execution_id uuid");
    expect(sql).toContain("add column if not exists lease_owner text");
    expect(sql).toContain("add column if not exists lease_expires_at timestamptz");
    expect(sql).toContain("add column if not exists lease_generation bigint");
  });

  it("creates the atomic claim function as a security invoker", () => {
    expect(sql).toContain("create or replace function public.claim_task_step");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("auth.uid() is null");
  });

  it("fences against duplicate step execution", () => {
    expect(sql).toContain("t.current_step = p_expected_step");
    expect(sql).toContain("t.status in ('queued', 'planning', 'running')");
    expect(sql).toContain("t.execution_id is null");
    expect(sql).toContain("t.lease_expires_at is null");
    expect(sql).toContain("t.lease_expires_at < now()");
  });

  it("generates a unique claim token", () => {
    expect(sql).toContain("execution_id = gen_random_uuid()");
    expect(sql).toContain("lease_generation = t.lease_generation + 1");
  });

  it("restricts function execution to authenticated users", () => {
    expect(sql).toContain("revoke execute on function public.claim_task_step");
    expect(sql).toContain("grant execute on function public.claim_task_step");
    expect(sql).toContain("to authenticated");
  });

  it("documents a rollback path", () => {
    expect(sql).toContain("Rollback:");
    expect(sql).toContain("drop function if exists public.claim_task_step");
  });
});
