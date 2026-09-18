"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { MediaClubLogo } from "@/components/MediaClubLogo";

function MicrosoftIcon() {
  return (
    <svg className="mr-2 h-4 w-4 shrink-0" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg className="mr-2 h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}


export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm shadow-md">
        <CardHeader className="text-center pb-4 flex flex-col items-center">
          <div className="mb-4 bg-black p-3.5 rounded-2xl border border-white/15 shadow-md flex items-center justify-center">
            <MediaClubLogo className="h-14 sm:h-16 w-auto" variant="white" />
          </div>
          <CardTitle className="text-2xl font-extrabold tracking-tight">
            MediaHub
          </CardTitle>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mt-0.5">
            Media Club Equipment Portal
          </span>
          <CardDescription className="text-xs mt-1">
            Sign in to manage your equipment & events
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Option 1: Google */}
          <Button
            className="w-full font-medium h-10"
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          >
            <GoogleIcon />
            Sign in with Google
          </Button>

          {/* Option 2: Microsoft (Directly below Google) */}
          <Button
            variant="outline"
            className="w-full font-medium h-10"
            onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/dashboard" })}
          >
            <MicrosoftIcon />
            Sign in with Microsoft
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
