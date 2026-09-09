export type Role = "admin" | "verified" | "viewer";

export type Condition = "New" | "Good" | "Fair" | "Poor";

export type EquipmentStatus =
  | "Available"
  | "Checked Out"
  | "In Event"
  | "In Event (Rehearsal)"
  | "Under Maintenance"
  | "Retired";

export interface Tag {
  id: number;
  name: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  username: string | null;
  google_id: string | null;
  image: string | null;
  role: Role;
  provider: string | null;
  nfc_id?: string | null;
  created_at: string;
}

export interface Equipment {
  id: number;
  name: string;
  tags: string[];
  description: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  condition: Condition;
  location: string;
  status: EquipmentStatus;
  created_at: string;
  updated_at: string;
  // joined from active checkout
  active_checkout_id: number | null;
  checked_out_by_name: string | null;
  checked_out_at: string | null;
  expected_return_at: string | null;
  checkout_location: string | null;
  // joined from ongoing event
  active_event_id?: number | null;
  active_event_name?: string | null;
  active_event_location?: string | null;
  active_event_start_time?: string | null;
  active_event_end_time?: string | null;
  is_rehearsal?: boolean;
}

export interface Checkout {
  id: number;
  equipment_id: number;
  checked_out_by: number | null;
  checked_out_by_name: string;
  checked_out_at: string;
  expected_return_at: string | null;
  returned_at: string | null;
  notes: string | null;
  checkout_location: string | null;
  nfc_id?: string | null;
}

export interface NFCCheckoutItem extends Checkout {
  equipment_name: string;
  equipment_serial_number: string | null;
  equipment_location: string;
}

export interface NFCMemberData {
  member: User;
  activeCheckouts: NFCCheckoutItem[];
  history: NFCCheckoutItem[];
}

export interface EventEquipmentLog {
  event_id: number;
  event_name: string;
  event_location: string;
  start_time: string;
  end_time: string;
  added_at: string;
  is_rehearsal?: boolean;
}

export interface EquipmentDetail extends Omit<Equipment, "active_checkout_id" | "checked_out_by_name" | "checked_out_at" | "expected_return_at"> {
  checkouts: Checkout[];
  active_checkout: Checkout | null;
  event_logs?: EventEquipmentLog[];
}

export type EventStatus = "Upcoming" | "Ongoing" | "Completed";
export type EventSection = "photo" | "video" | "av";

export interface SectionICMap {
  photo: User[];
  video: User[];
  av: User[];
}

export interface SectionEquipmentItem extends Equipment {
  used_for_rehearsal: boolean;
}

export interface SectionEquipmentMap {
  photo: SectionEquipmentItem[];
  video: SectionEquipmentItem[];
  av: SectionEquipmentItem[];
}

export type DeploymentResponseStatus = "pending" | "confirmed" | "declined";

export interface SectionDeploymentItem extends User {
  attending_rehearsal: boolean;
  response_status?: DeploymentResponseStatus;
  response_token?: string;
  responded_at?: string | null;
}

export interface SectionDeploymentMap {
  photo: SectionDeploymentItem[];
  video: SectionDeploymentItem[];
  av: SectionDeploymentItem[];
}

export interface SectionRehearsalConfig {
  participating: boolean;
}

export interface SectionRehearsalMap {
  photo: SectionRehearsalConfig;
  video: SectionRehearsalConfig;
  av: SectionRehearsalConfig;
}

export interface AppEvent {
  id: number;
  name: string;
  description: string | null;
  start_time: string;
  end_time: string;
  location: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  has_rehearsal: boolean;
  rehearsal_start_time: string | null;
  rehearsal_end_time: string | null;
  oics: User[];
  section_ics: SectionICMap;
  section_equipment: SectionEquipmentMap;
  section_deployments: SectionDeploymentMap;
  section_rehearsals: SectionRehearsalMap;
  status: EventStatus;
}

export interface SOPDocument {
  id: number;
  title: string;
  category: string;
  content: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: number | null;
  uploaded_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SOPCitation {
  document_id: number;
  document_title: string;
  section_title?: string;
  snippet: string;
}

export interface AIChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: SOPCitation[];
  created_at?: string;
}

// Extend next-auth Session type
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: Role;
      username: string | null;
    };
  }
}
