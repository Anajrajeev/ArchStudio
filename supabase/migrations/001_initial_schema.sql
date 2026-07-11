-- ArchStudio initial schema
-- Run against a Supabase project (Postgres 15+)

-- ============================================================
-- PROFILES
-- ============================================================
create table if not exists public.profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    avatar_url  text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
    on public.profiles for select
    using (auth.uid() = id);

create policy "Users can update their own profile"
    on public.profiles for update
    using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
    insert into public.profiles (id, display_name, avatar_url)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        new.raw_user_meta_data->>'avatar_url'
    );
    return new;
end;
$$;

create or replace trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();


-- ============================================================
-- PROJECTS
-- ============================================================
create table if not exists public.projects (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references auth.users(id) on delete cascade,
    name         text not null default 'Untitled Project',
    scene_graph  jsonb not null default '{"schemaVersion":1,"storeys":[],"walls":[],"openings":[],"rooms":[],"furniture":[],"materials":[]}'::jsonb,
    thumbnail_url text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects(user_id);

alter table public.projects enable row level security;

create policy "Users can view their own projects"
    on public.projects for select
    using (auth.uid() = user_id);

create policy "Users can insert their own projects"
    on public.projects for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own projects"
    on public.projects for update
    using (auth.uid() = user_id);

create policy "Users can delete their own projects"
    on public.projects for delete
    using (auth.uid() = user_id);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create or replace trigger projects_updated_at
    before update on public.projects
    for each row execute function public.set_updated_at();


-- ============================================================
-- PROJECT VERSIONS (snapshots)
-- ============================================================
create table if not exists public.project_versions (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references public.projects(id) on delete cascade,
    scene_graph jsonb not null,
    label       text,             -- optional user-set label
    created_at  timestamptz not null default now()
);

create index if not exists project_versions_project_id_idx on public.project_versions(project_id);

alter table public.project_versions enable row level security;

create policy "Users can view versions of their own projects"
    on public.project_versions for select
    using (
        exists (
            select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid()
        )
    );

create policy "Users can insert versions for their own projects"
    on public.project_versions for insert
    with check (
        exists (
            select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid()
        )
    );


-- ============================================================
-- CHAT MESSAGES
-- ============================================================
create table if not exists public.chat_messages (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references public.projects(id) on delete cascade,
    role        text not null check (role in ('user', 'assistant', 'tool')),
    content     text,
    tool_calls  jsonb,          -- array of tool call objects from the AI SDK
    created_at  timestamptz not null default now()
);

create index if not exists chat_messages_project_id_idx on public.chat_messages(project_id);
create index if not exists chat_messages_created_at_idx on public.chat_messages(project_id, created_at);

alter table public.chat_messages enable row level security;

create policy "Users can view messages for their own projects"
    on public.chat_messages for select
    using (
        exists (
            select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid()
        )
    );

create policy "Users can insert messages for their own projects"
    on public.chat_messages for insert
    with check (
        exists (
            select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid()
        )
    );


-- ============================================================
-- USER AI KEYS (BYOK)
-- ============================================================
create table if not exists public.user_ai_keys (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references auth.users(id) on delete cascade,
    provider         text not null check (provider in ('anthropic', 'openai')),
    encrypted_key    text not null,    -- Fernet-encrypted, stored as base64 string
    key_hint         text not null,    -- last 4 characters of the original key
    model_preference text,             -- user's preferred model for this provider
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (user_id, provider)
);

alter table public.user_ai_keys enable row level security;

create policy "Users can view their own AI keys"
    on public.user_ai_keys for select
    using (auth.uid() = user_id);

create policy "Users can insert their own AI keys"
    on public.user_ai_keys for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own AI keys"
    on public.user_ai_keys for update
    using (auth.uid() = user_id);

create policy "Users can delete their own AI keys"
    on public.user_ai_keys for delete
    using (auth.uid() = user_id);

create or replace trigger user_ai_keys_updated_at
    before update on public.user_ai_keys
    for each row execute function public.set_updated_at();


-- ============================================================
-- CATALOG ITEMS (furniture, materials — read-only public)
-- ============================================================
create table if not exists public.catalog_items (
    id           uuid primary key default gen_random_uuid(),
    name         text not null,
    category     text not null,         -- e.g. 'furniture', 'material'
    subcategory  text,                  -- e.g. 'seating', 'tables', 'flooring'
    gltf_url     text,                  -- Supabase Storage URL
    thumbnail_url text,
    metadata     jsonb default '{}'::jsonb,
    created_at   timestamptz not null default now()
);

create index if not exists catalog_items_category_idx on public.catalog_items(category);

alter table public.catalog_items enable row level security;

create policy "Catalog items are readable by everyone"
    on public.catalog_items for select
    using (true);
