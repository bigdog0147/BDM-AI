


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."bdm_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."bdm_set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."bdm_audit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "action" "text" NOT NULL,
    "status" "text" DEFAULT 'recorded'::"text" NOT NULL,
    "tool_key" "text",
    "conversation_id" "uuid",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bdm_audit_events_status_check" CHECK (("status" = ANY (ARRAY['recorded'::"text", 'requested'::"text", 'approved'::"text", 'denied'::"text", 'started'::"text", 'succeeded'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."bdm_audit_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bdm_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text",
    "model_hint" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bdm_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bdm_knowledge_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source_type" "text" DEFAULT 'web'::"text" NOT NULL,
    "title" "text",
    "source_uri" "text",
    "content" "text" NOT NULL,
    "citation" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bdm_knowledge_items_source_type_check" CHECK (("source_type" = ANY (ARRAY['web'::"text", 'file'::"text", 'note'::"text", 'conversation'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."bdm_knowledge_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bdm_memories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "kind" "text" DEFAULT 'fact'::"text" NOT NULL,
    "content" "text" NOT NULL,
    "importance" smallint DEFAULT 50 NOT NULL,
    "source_conversation_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "pinned" boolean DEFAULT false NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bdm_memories_importance_check" CHECK ((("importance" >= 0) AND ("importance" <= 100))),
    CONSTRAINT "bdm_memories_kind_check" CHECK (("kind" = ANY (ARRAY['fact'::"text", 'preference'::"text", 'goal'::"text", 'project'::"text", 'person'::"text", 'instruction'::"text", 'summary'::"text"])))
);


ALTER TABLE "public"."bdm_memories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bdm_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "model" "text",
    "tool_name" "text",
    "tool_call_id" "text",
    "token_usage" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bdm_messages_role_check" CHECK (("role" = ANY (ARRAY['system'::"text", 'user'::"text", 'assistant'::"text", 'tool'::"text"])))
);


ALTER TABLE "public"."bdm_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bdm_profiles" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text",
    "preferred_name" "text",
    "timezone" "text",
    "locale" "text" DEFAULT 'en'::"text" NOT NULL,
    "personality" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bdm_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bdm_tool_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tool_key" "text" NOT NULL,
    "permission_level" "text" DEFAULT 'ask'::"text" NOT NULL,
    "constraints" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bdm_tool_permissions_permission_level_check" CHECK (("permission_level" = ANY (ARRAY['deny'::"text", 'ask'::"text", 'allow'::"text"])))
);


ALTER TABLE "public"."bdm_tool_permissions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."bdm_audit_events"
    ADD CONSTRAINT "bdm_audit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bdm_conversations"
    ADD CONSTRAINT "bdm_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bdm_knowledge_items"
    ADD CONSTRAINT "bdm_knowledge_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bdm_memories"
    ADD CONSTRAINT "bdm_memories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bdm_messages"
    ADD CONSTRAINT "bdm_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bdm_profiles"
    ADD CONSTRAINT "bdm_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."bdm_tool_permissions"
    ADD CONSTRAINT "bdm_tool_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bdm_tool_permissions"
    ADD CONSTRAINT "bdm_tool_permissions_user_id_tool_key_key" UNIQUE ("user_id", "tool_key");



CREATE INDEX "bdm_audit_user_created_idx" ON "public"."bdm_audit_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "bdm_conversations_user_updated_idx" ON "public"."bdm_conversations" USING "btree" ("user_id", "updated_at" DESC);



CREATE INDEX "bdm_knowledge_user_created_idx" ON "public"."bdm_knowledge_items" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "bdm_memories_user_importance_idx" ON "public"."bdm_memories" USING "btree" ("user_id", "pinned" DESC, "importance" DESC, "updated_at" DESC);



CREATE INDEX "bdm_messages_conversation_created_idx" ON "public"."bdm_messages" USING "btree" ("conversation_id", "created_at");



CREATE OR REPLACE TRIGGER "bdm_conversations_set_updated_at" BEFORE UPDATE ON "public"."bdm_conversations" FOR EACH ROW EXECUTE FUNCTION "public"."bdm_set_updated_at"();



CREATE OR REPLACE TRIGGER "bdm_knowledge_set_updated_at" BEFORE UPDATE ON "public"."bdm_knowledge_items" FOR EACH ROW EXECUTE FUNCTION "public"."bdm_set_updated_at"();



CREATE OR REPLACE TRIGGER "bdm_memories_set_updated_at" BEFORE UPDATE ON "public"."bdm_memories" FOR EACH ROW EXECUTE FUNCTION "public"."bdm_set_updated_at"();



CREATE OR REPLACE TRIGGER "bdm_profiles_set_updated_at" BEFORE UPDATE ON "public"."bdm_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."bdm_set_updated_at"();



CREATE OR REPLACE TRIGGER "bdm_tool_permissions_set_updated_at" BEFORE UPDATE ON "public"."bdm_tool_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."bdm_set_updated_at"();



ALTER TABLE ONLY "public"."bdm_audit_events"
    ADD CONSTRAINT "bdm_audit_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."bdm_conversations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bdm_audit_events"
    ADD CONSTRAINT "bdm_audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bdm_conversations"
    ADD CONSTRAINT "bdm_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bdm_knowledge_items"
    ADD CONSTRAINT "bdm_knowledge_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bdm_memories"
    ADD CONSTRAINT "bdm_memories_source_conversation_id_fkey" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."bdm_conversations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bdm_memories"
    ADD CONSTRAINT "bdm_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bdm_messages"
    ADD CONSTRAINT "bdm_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."bdm_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bdm_profiles"
    ADD CONSTRAINT "bdm_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bdm_tool_permissions"
    ADD CONSTRAINT "bdm_tool_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."bdm_audit_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bdm_audit_insert_own" ON "public"."bdm_audit_events" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_audit_select_own" ON "public"."bdm_audit_events" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."bdm_conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bdm_conversations_delete_own" ON "public"."bdm_conversations" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_conversations_insert_own" ON "public"."bdm_conversations" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_conversations_select_own" ON "public"."bdm_conversations" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_conversations_update_own" ON "public"."bdm_conversations" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_knowledge_delete_own" ON "public"."bdm_knowledge_items" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_knowledge_insert_own" ON "public"."bdm_knowledge_items" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."bdm_knowledge_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bdm_knowledge_select_own" ON "public"."bdm_knowledge_items" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_knowledge_update_own" ON "public"."bdm_knowledge_items" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."bdm_memories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bdm_memories_delete_own" ON "public"."bdm_memories" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_memories_insert_own" ON "public"."bdm_memories" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_memories_select_own" ON "public"."bdm_memories" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_memories_update_own" ON "public"."bdm_memories" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."bdm_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bdm_messages_delete_own" ON "public"."bdm_messages" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bdm_conversations" "c"
  WHERE (("c"."id" = "bdm_messages"."conversation_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "bdm_messages_insert_own" ON "public"."bdm_messages" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."bdm_conversations" "c"
  WHERE (("c"."id" = "bdm_messages"."conversation_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "bdm_messages_select_own" ON "public"."bdm_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bdm_conversations" "c"
  WHERE (("c"."id" = "bdm_messages"."conversation_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "bdm_messages_update_own" ON "public"."bdm_messages" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bdm_conversations" "c"
  WHERE (("c"."id" = "bdm_messages"."conversation_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."bdm_conversations" "c"
  WHERE (("c"."id" = "bdm_messages"."conversation_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."bdm_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bdm_profiles_delete_own" ON "public"."bdm_profiles" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_profiles_insert_own" ON "public"."bdm_profiles" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_profiles_select_own" ON "public"."bdm_profiles" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_profiles_update_own" ON "public"."bdm_profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."bdm_tool_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bdm_tool_permissions_delete_own" ON "public"."bdm_tool_permissions" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_tool_permissions_insert_own" ON "public"."bdm_tool_permissions" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_tool_permissions_select_own" ON "public"."bdm_tool_permissions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bdm_tool_permissions_update_own" ON "public"."bdm_tool_permissions" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."bdm_set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bdm_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."bdm_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bdm_set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."bdm_audit_events" TO "anon";
GRANT ALL ON TABLE "public"."bdm_audit_events" TO "authenticated";
GRANT ALL ON TABLE "public"."bdm_audit_events" TO "service_role";



GRANT ALL ON TABLE "public"."bdm_conversations" TO "anon";
GRANT ALL ON TABLE "public"."bdm_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."bdm_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."bdm_knowledge_items" TO "anon";
GRANT ALL ON TABLE "public"."bdm_knowledge_items" TO "authenticated";
GRANT ALL ON TABLE "public"."bdm_knowledge_items" TO "service_role";



GRANT ALL ON TABLE "public"."bdm_memories" TO "anon";
GRANT ALL ON TABLE "public"."bdm_memories" TO "authenticated";
GRANT ALL ON TABLE "public"."bdm_memories" TO "service_role";



GRANT ALL ON TABLE "public"."bdm_messages" TO "anon";
GRANT ALL ON TABLE "public"."bdm_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."bdm_messages" TO "service_role";



GRANT ALL ON TABLE "public"."bdm_profiles" TO "anon";
GRANT ALL ON TABLE "public"."bdm_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."bdm_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."bdm_tool_permissions" TO "anon";
GRANT ALL ON TABLE "public"."bdm_tool_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."bdm_tool_permissions" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







