import { db } from "./firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  runTransaction,
} from "firebase/firestore";
import type {
  Equipment,
  EquipmentDetail,
  Checkout,
  User,
  Role,
  EquipmentStatus,
  Condition,
  Tag,
} from "./types";

// ---------------------------------------------------------------------------
// Atomic Sequential ID Generator using Firestore Counters
// ---------------------------------------------------------------------------

async function getNextId(counterName: string): Promise<number> {
  const counterRef = doc(db, "counters", counterName);
  return await runTransaction(db, async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    let nextId = 1;
    if (counterDoc.exists()) {
      nextId = (counterDoc.data().current || 0) + 1;
    }
    transaction.set(counterRef, { current: nextId }, { merge: true });
    return nextId;
  });
}

function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const q = query(collection(db, "users"), where("email", "==", email));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return undefined;
  return snapshot.docs[0].data() as User;
}

export async function getUserById(id: number): Promise<User | undefined> {
  const docRef = doc(db, "users", String(id));
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return undefined;
  return docSnap.data() as User;
}

export async function getAllUsers(): Promise<User[]> {
  const q = query(collection(db, "users"), orderBy("created_at", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => docSnap.data() as User);
}

export async function countUsers(): Promise<number> {
  const snapshot = await getDocs(collection(db, "users"));
  return snapshot.size;
}

export async function upsertUser(params: {
  name: string;
  email: string;
  google_id: string;
  image: string | null;
  provider: string;
}): Promise<User> {
  const existing = await getUserByEmail(params.email);
  const adminEmails = getAdminEmails();
  const isAdminEmail = adminEmails.has(params.email.toLowerCase());

  if (existing) {
    const newRole = isAdminEmail && existing.role !== "admin" ? "admin" : existing.role;
    const userRef = doc(db, "users", String(existing.id));
    await updateDoc(userRef, {
      name: params.name,
      google_id: params.google_id,
      image: params.image,
      provider: params.provider,
      role: newRole,
    });
    return (await getUserById(existing.id))!;
  }

  const count = await countUsers();
  const role: Role = isAdminEmail || count === 0 ? "admin" : "viewer";
  const newId = await getNextId("users");
  const userRef = doc(db, "users", String(newId));
  
  const newUser: User = {
    id: newId,
    name: params.name,
    email: params.email,
    username: null,
    google_id: params.google_id,
    image: params.image,
    role,
    provider: params.provider,
    created_at: new Date().toISOString(),
  };

  await setDoc(userRef, newUser);
  return newUser;
}

export async function updateUserRole(id: number, role: Role): Promise<void> {
  const userRef = doc(db, "users", String(id));
  await updateDoc(userRef, { role });
}

export async function deleteUser(id: number): Promise<void> {
  const userRef = doc(db, "users", String(id));
  await deleteDoc(userRef);
}

export async function updateUsername(id: number, username: string): Promise<void> {
  const userRef = doc(db, "users", String(id));
  await updateDoc(userRef, { username });
}

// ---------------------------------------------------------------------------
// Active checkout query helper
// ---------------------------------------------------------------------------

async function getActiveCheckout(equipmentId: number): Promise<Checkout | null> {
  const q = query(
    collection(db, "checkouts"),
    where("equipment_id", "==", equipmentId),
    where("returned_at", "==", null)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as Checkout;
}

// ---------------------------------------------------------------------------
// Equipment helpers
// ---------------------------------------------------------------------------

export async function getAllEquipment(): Promise<Equipment[]> {
  const q = query(collection(db, "equipment"), orderBy("updated_at", "desc"));
  const snapshot = await getDocs(q);
  const equipmentList = snapshot.docs.map((docSnap) => docSnap.data() as Equipment);

  const checkoutsSnap = await getDocs(
    query(collection(db, "checkouts"), where("returned_at", "==", null))
  );
  const activeCheckoutsMap = new Map<number, Checkout>();
  checkoutsSnap.docs.forEach((d) => {
    const c = d.data() as Checkout;
    activeCheckoutsMap.set(c.equipment_id, c);
  });

  return equipmentList.map((eq) => {
    const active = activeCheckoutsMap.get(eq.id);
    return {
      ...eq,
      active_checkout_id: active ? active.id : null,
      checked_out_by_name: active ? active.checked_out_by_name : null,
      checked_out_at: active ? active.checked_out_at : null,
      expected_return_at: active ? active.expected_return_at : null,
      checkout_location: active ? active.checkout_location : null,
    };
  });
}

export async function getEquipmentById(id: number): Promise<EquipmentDetail | undefined> {
  const docRef = doc(db, "equipment", String(id));
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return undefined;

  const eq = docSnap.data() as Equipment;

  const checkoutsSnap = await getDocs(
    query(
      collection(db, "checkouts"),
      where("equipment_id", "==", id),
      orderBy("checked_out_at", "desc")
    )
  );

  const checkouts = checkoutsSnap.docs.map((d) => d.data() as Checkout);
  const active_checkout = checkouts.find((c) => c.returned_at === null) ?? null;

  return {
    ...eq,
    checkouts,
    active_checkout,
  };
}

export async function createEquipment(params: {
  name: string;
  tags: string[];
  description?: string;
  serial_number?: string;
  purchase_date?: string;
  condition: Condition;
  quantity: number;
  location: string;
  status: EquipmentStatus;
}): Promise<Equipment> {
  const newId = await getNextId("equipment");
  const now = new Date().toISOString();
  const eqRef = doc(db, "equipment", String(newId));

  const newEquipment: Equipment = {
    id: newId,
    name: params.name,
    description: params.description ?? null,
    serial_number: params.serial_number ?? null,
    purchase_date: params.purchase_date ?? null,
    condition: params.condition,
    quantity: params.quantity,
    location: params.location,
    status: params.status,
    tags: params.tags ?? [],
    created_at: now,
    updated_at: now,
    active_checkout_id: null,
    checked_out_by_name: null,
    checked_out_at: null,
    expected_return_at: null,
    checkout_location: null,
  };

  await setDoc(eqRef, newEquipment);

  // Sync equipment_tags collection for join queries
  if (params.tags && params.tags.length > 0) {
    const allTags = await getAllTags();
    for (const tagName of params.tags) {
      let tagObj = allTags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
      if (!tagObj) {
        tagObj = await createTag(tagName);
      }
      const linkRef = doc(db, "equipment_tags", `${newId}_${tagObj.id}`);
      await setDoc(linkRef, { equipment_id: newId, tag_id: tagObj.id });
    }
  }

  return newEquipment;
}

export async function updateEquipment(
  id: number,
  params: Partial<{
    name: string;
    tags: string[];
    description: string;
    serial_number: string;
    purchase_date: string;
    condition: Condition;
    quantity: number;
    location: string;
    status: EquipmentStatus;
  }>
): Promise<EquipmentDetail | undefined> {
  const eqRef = doc(db, "equipment", String(id));
  const docSnap = await getDoc(eqRef);
  if (!docSnap.exists()) return undefined;

  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updated_at: now };

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined) {
      updateData[k] = v;
    }
  });

  await updateDoc(eqRef, updateData);

  if (params.tags !== undefined) {
    // Delete existing links for equipment_id
    const linksSnap = await getDocs(
      query(collection(db, "equipment_tags"), where("equipment_id", "==", id))
    );
    for (const linkDoc of linksSnap.docs) {
      await deleteDoc(linkDoc.ref);
    }
    // Add new links
    const allTags = await getAllTags();
    for (const tagName of params.tags) {
      let tagObj = allTags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
      if (!tagObj) {
        tagObj = await createTag(tagName);
      }
      const linkRef = doc(db, "equipment_tags", `${id}_${tagObj.id}`);
      await setDoc(linkRef, { equipment_id: id, tag_id: tagObj.id });
    }
  }

  return getEquipmentById(id);
}

export async function deleteEquipment(id: number): Promise<{ success: boolean; error?: string }> {
  const active = await getActiveCheckout(id);
  if (active) {
    return { success: false, error: "Cannot delete equipment with an active checkout." };
  }

  const eqRef = doc(db, "equipment", String(id));
  await deleteDoc(eqRef);

  // Clean up tag links
  const linksSnap = await getDocs(
    query(collection(db, "equipment_tags"), where("equipment_id", "==", id))
  );
  for (const linkDoc of linksSnap.docs) {
    await deleteDoc(linkDoc.ref);
  }

  return { success: true };
}

export async function getEquipmentByTagId(tagId: number): Promise<Equipment[]> {
  const linksSnap = await getDocs(
    query(collection(db, "equipment_tags"), where("tag_id", "==", tagId))
  );
  const equipmentIds = linksSnap.docs.map((d) => d.data().equipment_id as number);
  if (equipmentIds.length === 0) return [];

  const allEq = await getAllEquipment();
  return allEq.filter((eq) => equipmentIds.includes(eq.id));
}

export async function addTagToEquipment(
  equipmentId: number,
  tagId: number
): Promise<{ success: boolean; error?: string }> {
  const eq = await getEquipmentById(equipmentId);
  if (!eq) return { success: false, error: "Equipment not found." };

  const tagRef = doc(db, "tags", String(tagId));
  const tagSnap = await getDoc(tagRef);
  if (!tagSnap.exists()) return { success: false, error: "Tag not found." };

  const tagObj = tagSnap.data() as Tag;
  const newTags = Array.from(new Set([...eq.tags, tagObj.name]));

  const linkRef = doc(db, "equipment_tags", `${equipmentId}_${tagId}`);
  await setDoc(linkRef, { equipment_id: equipmentId, tag_id: tagId });

  await updateDoc(doc(db, "equipment", String(equipmentId)), {
    tags: newTags,
    updated_at: new Date().toISOString(),
  });

  return { success: true };
}

export async function removeTagFromEquipment(
  equipmentId: number,
  tagId: number
): Promise<{ success: boolean; error?: string }> {
  const tagRef = doc(db, "tags", String(tagId));
  const tagSnap = await getDoc(tagRef);
  const tagObj = tagSnap.exists() ? (tagSnap.data() as Tag) : null;

  const linkRef = doc(db, "equipment_tags", `${equipmentId}_${tagId}`);
  await deleteDoc(linkRef);

  const eq = await getEquipmentById(equipmentId);
  if (eq && tagObj) {
    const newTags = eq.tags.filter((t) => t.toLowerCase() !== tagObj.name.toLowerCase());
    await updateDoc(doc(db, "equipment", String(equipmentId)), {
      tags: newTags,
      updated_at: new Date().toISOString(),
    });
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Checkout helpers
// ---------------------------------------------------------------------------

export async function createCheckout(params: {
  equipment_id: number;
  checked_out_by: number | null;
  checked_out_by_name: string;
  expected_return_at?: string;
  notes?: string;
  checkout_location?: string;
}): Promise<Checkout> {
  const active = await getActiveCheckout(params.equipment_id);
  if (active) throw new Error("Equipment is already checked out.");

  const newId = await getNextId("checkouts");
  const now = new Date().toISOString();
  const checkoutRef = doc(db, "checkouts", String(newId));

  const newCheckout: Checkout = {
    id: newId,
    equipment_id: params.equipment_id,
    checked_out_by: params.checked_out_by ?? null,
    checked_out_by_name: params.checked_out_by_name,
    checked_out_at: now,
    expected_return_at: params.expected_return_at ?? null,
    returned_at: null,
    notes: params.notes ?? null,
    checkout_location: params.checkout_location ?? null,
  };

  await setDoc(checkoutRef, newCheckout);

  const eqRef = doc(db, "equipment", String(params.equipment_id));
  await updateDoc(eqRef, {
    status: "Checked Out",
    updated_at: now,
  });

  return newCheckout;
}

export async function returnCheckout(equipment_id: number): Promise<Checkout> {
  const active = await getActiveCheckout(equipment_id);
  if (!active) throw new Error("No active checkout found for this equipment.");

  const now = new Date().toISOString();
  const checkoutRef = doc(db, "checkouts", String(active.id));
  await updateDoc(checkoutRef, { returned_at: now });

  const eqRef = doc(db, "equipment", String(equipment_id));
  await updateDoc(eqRef, {
    status: "Available",
    updated_at: now,
  });

  return {
    ...active,
    returned_at: now,
  };
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

export async function getAllTags(): Promise<Tag[]> {
  const q = query(collection(db, "tags"), orderBy("name", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as Tag);
}

export async function createTag(name: string): Promise<Tag> {
  const newId = await getNextId("tags");
  const tagRef = doc(db, "tags", String(newId));
  const newTag: Tag = { id: newId, name };
  await setDoc(tagRef, newTag);
  return newTag;
}

export async function deleteTag(id: number): Promise<{ success: boolean; error?: string }> {
  const tagRef = doc(db, "tags", String(id));
  const tagSnap = await getDoc(tagRef);
  if (!tagSnap.exists()) return { success: false, error: "Tag not found." };

  const inUseSnap = await getDocs(
    query(collection(db, "equipment_tags"), where("tag_id", "==", id))
  );
  if (!inUseSnap.empty) {
    return { success: false, error: "Cannot delete a tag that is in use by equipment." };
  }

  await deleteDoc(tagRef);
  return { success: true };
}
