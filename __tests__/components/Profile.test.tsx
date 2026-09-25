import React from "react";
import { render, screen } from "@testing-library/react";
import { UserLink } from "@/components/UserLink";
import { ProfileClient } from "@/components/ProfileClient";
import type { UserProfileData } from "@/lib/types";

// Mock useSession from next-auth/react
let mockSessionData: any = null;

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: mockSessionData, status: mockSessionData ? "authenticated" : "unauthenticated" }),
  signIn: jest.fn(),
  signOut: jest.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    refresh: jest.fn(),
  }),
}));

describe("UserLink Component", () => {
  test("renders link with userId when userId is provided", () => {
    render(<UserLink name="Alice Smith" username="alice_s" userId={1} />);
    const link = screen.getByRole("link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/dashboard/profile?id=1");
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  test("renders link with username when userId is missing", () => {
    render(<UserLink name="Bob Viewer" username="bob_v" />);
    const link = screen.getByRole("link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/dashboard/profile?username=bob_v");
  });

  test("renders link with encoded name when username and userId are missing", () => {
    render(<UserLink name="Charlie Brown" />);
    const link = screen.getByRole("link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/dashboard/profile?username=Charlie%20Brown");
  });
});

describe("ProfileClient Component", () => {
  const mockProfileData: UserProfileData = {
    user: {
      id: 2,
      name: "Bob Viewer",
      email: "bob@club.com",
      username: "bob_v",
      role: "viewer",
      google_id: null,
      image: null,
      provider: "google",
      created_at: "2026-09-01T00:00:00Z",
    },
    activeEquipment: [
      {
        id: 101,
        equipment_id: 1,
        equipment_name: "Sony FX3 Camera",
        equipment_serial_number: "CAM-01",
        equipment_location: "Media Room",
        equipment_condition: "Working",
        checked_out_by: 2,
        checked_out_by_name: "Bob Viewer",
        checked_out_at: "2026-09-20T10:00:00Z",
        expected_return_at: "2026-09-22T18:00:00Z",
        returned_at: null,
        notes: "For annual shoot",
        checkout_location: "Showroom",
      },
    ],
    pastEquipment: [
      {
        id: 100,
        equipment_id: 2,
        equipment_name: "Tripod Pro",
        equipment_serial_number: "TRI-01",
        equipment_location: "Media Room",
        equipment_condition: "Working",
        checked_out_by: 2,
        checked_out_by_name: "Bob Viewer",
        checked_out_at: "2026-09-10T10:00:00Z",
        expected_return_at: "2026-09-12T18:00:00Z",
        returned_at: "2026-09-12T17:00:00Z",
        notes: null,
        checkout_location: null,
      },
    ],
    events: [
      {
        event_id: 10,
        event_name: "National Day Shoot",
        description: "Official coverage",
        start_time: "2026-10-01T08:00:00Z",
        end_time: "2026-10-01T14:00:00Z",
        location: "Padang",
        has_rehearsal: false,
        rehearsal_start_time: null,
        rehearsal_end_time: null,
        status: "Upcoming",
        roles: [
          {
            type: "section_ic",
            section: "photo",
            label: "PHOTO In-Charge (IC)",
          },
        ],
      },
    ],
    nfcCard: {
      id: 5,
      nfc_value: "NFC_UID_999",
      member_name: "Bob Viewer",
      notes: "Card issued 2026",
      created_at: "2026-09-01T00:00:00Z",
    },
    stats: {
      activePossessionsCount: 1,
      totalCheckoutsCount: 2,
      upcomingEventsCount: 1,
      completedEventsCount: 0,
    },
  };

  test("renders profile details and active possessions", () => {
    render(
      <ProfileClient
        initialData={mockProfileData}
        viewerRole="viewer"
        viewerId="2"
        isSelf={true}
      />
    );

    expect(screen.getByText("Bob Viewer")).toBeInTheDocument();
    expect(screen.getByText("@bob_v")).toBeInTheDocument();
    expect(screen.getByText("bob@club.com")).toBeInTheDocument();
    expect(screen.getByText("Sony FX3 Camera")).toBeInTheDocument();
    expect(screen.getByText("CAM-01")).toBeInTheDocument();
  });

  test("renders admin inspection banner when admin views someone else", () => {
    render(
      <ProfileClient
        initialData={mockProfileData}
        viewerRole="admin"
        viewerId="1"
        isSelf={false}
      />
    );

    expect(screen.getByText(/Viewing profile for/i)).toBeInTheDocument();
    expect(screen.getByText(/Back to Users/i)).toBeInTheDocument();
  });
});
