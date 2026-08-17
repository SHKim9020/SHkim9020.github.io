const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const cloud = fs.readFileSync(path.join(root, "cloud.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sql = fs.readFileSync(path.join(root, "supabase/setup.sql"), "utf8");

test("account UI offers login, signup, password reset, and project list", () => {
  for (const id of ["accountBtn", "cloudProjectsBtn", "accountDialog", "loginForm", "signupForm", "resetForm", "cloudProjectsDialog", "cloudProjectList"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /name="username"/);
  assert.match(html, /name="passwordConfirm"/);
  assert.match(html, /@supabase\/supabase-js@2/);
});

test("cloud client supports auth and per-account project CRUD", () => {
  assert.match(cloud, /auth\.signUp/);
  assert.match(cloud, /auth\.signInWithPassword/);
  assert.match(cloud, /auth\.resetPasswordForEmail/);
  assert.match(cloud, /from\("projects"\)\.insert/);
  assert.match(cloud, /from\("projects"\)\.update/);
  assert.match(cloud, /from\("projects"\)\.delete/);
  assert.match(cloud, /scheduleCloudAutosave/);
  assert.match(app, /onemaker:project-change/);
});

test("database setup isolates projects with row level security", () => {
  assert.match(sql, /create table if not exists public\.profiles/);
  assert.match(sql, /create table if not exists public\.projects/);
  assert.match(sql, /alter table public\.projects enable row level security/);
  assert.match(sql, /auth\.uid\(\) = user_id/g);
  assert.match(sql, /on delete cascade/);
});
