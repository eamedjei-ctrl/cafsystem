/**
 * Runs the real Supabase migrations inside an in-process Postgres (PGlite) so
 * the check-in rules and Row Level Security policies can be tested without
 * Docker or a Supabase project.
 *
 * Before the migrations run we recreate the parts of Supabase they depend on:
 *   - the anon / authenticated / service_role roles (service_role bypasses RLS)
 *   - Supabase's default grants (broad table access, relying on RLS)
 *   - a minimal auth schema: auth.users and auth.uid()
 *
 * Queries are then executed "as" a user by switching to the authenticated role
 * and setting request.jwt.claims, the same way PostgREST does.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(import.meta.dirname, '../../supabase/migrations')

const SUPABASE_BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );

  create function auth.uid() returns uuid language sql stable as $$
    select nullif(
      coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
      ),
      ''
    )::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`

export class TestDb {
  constructor(pg) {
    this.pg = pg
  }

  static async create() {
    const pg = new PGlite()
    await pg.exec(SUPABASE_BOOTSTRAP)
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    }
    return new TestDb(pg)
  }

  /** Superuser query (bypasses RLS), for arranging test data. */
  async sql(query, params = []) {
    const res = await this.pg.query(query, params)
    return res.rows
  }

  /** Create an auth user (the migration's trigger creates the staff profile). */
  async createUser(email, role, { active = true } = {}) {
    const [{ id }] = await this.sql(
      `insert into auth.users (id, email, raw_user_meta_data)
       values (gen_random_uuid(), $1, jsonb_build_object('full_name', $1::text)) returning id`,
      [email],
    )
    await this.sql(`update public.staff_profiles set role = $2, active = $3 where id = $1`, [id, role, active])
    return { id, email }
  }

  async addStudent(code, first, last, active = true) {
    const [row] = await this.sql(
      `insert into public.students (student_code, first_name, last_name, active)
       values ($1, $2, $3, $4) returning id`,
      [code, first, last, active],
    )
    return row.id
  }

  /**
   * Run a query as a signed-in user (role "authenticated" + JWT sub) or as an
   * anonymous visitor (user = null), inside a transaction so the connection
   * always returns to the superuser role afterwards.
   */
  async as(user, query, params = []) {
    const role = user ? 'authenticated' : 'anon'
    const claims = JSON.stringify(user ? { sub: user.id, role } : { role })
    return this.pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
      await tx.exec(`set local role ${role}`)
      const res = await tx.query(query, params)
      return res.rows
    })
  }

  async close() {
    await this.pg.close()
  }
}
