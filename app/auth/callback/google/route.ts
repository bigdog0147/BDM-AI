import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "https://bdmai.cloud/auth/callback/google";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    console.error("Google OAuth error:", error);
    return NextResponse.redirect(new URL("/?error=oauth_denied", request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error("Google OAuth credentials not configured");
    return NextResponse.redirect(new URL("/?error=not_configured", request.url));
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("Token exchange failed:", errorData);
      return NextResponse.redirect(new URL("/?error=token_exchange_failed", request.url));
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, id_token } = tokens;

    // Get user info from Google
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userResponse.ok) {
      return NextResponse.redirect(new URL("/?error=userinfo_failed", request.url));
    }

    const googleUser = await userResponse.json();
    const { email, name, picture, id: googleId } = googleUser;

    if (!email) {
      return NextResponse.redirect(new URL("/?error=no_email", request.url));
    }

    // Create Supabase client with service role for server-side operations
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user exists, create or update
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    let userId: string;

    if (fetchError && fetchError.code === "PGRST116") {
      // User doesn't exist, create new user
      const { data: newUser, error: createError } = await supabase
        .from("users")
        .insert({
          email,
          name: name || email.split("@")[0],
          avatar_url: picture,
          google_id: googleId,
          email_verified: true,
        })
        .select("id")
        .single();

      if (createError) {
        console.error("User creation failed:", createError);
        return NextResponse.redirect(new URL("/?error=user_creation_failed", request.url));
      }
      userId = newUser.id;
    } else if (fetchError) {
      console.error("User fetch failed:", fetchError);
      return NextResponse.redirect(new URL("/?error=db_error", request.url));
    } else {
      // User exists, update Google info if needed
      userId = existingUser.id;
      await supabase
        .from("users")
        .update({
          google_id: googleId,
          avatar_url: picture || existingUser.avatar_url,
          name: name || existingUser.name,
          email_verified: true,
        })
        .eq("id", userId);
    }

    // Create session cookie
    const sessionResponse = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: "https://bdmai.cloud" },
    });

    if (sessionResponse.error) {
      console.error("Session creation failed:", sessionResponse.error);
      return NextResponse.redirect(new URL("/?error=session_failed", request.url));
    }

    // Redirect to home with success
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set("sb-access-token", sessionResponse.data.properties?.access_token || "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(new URL("/?error=server_error", request.url));
  }
}