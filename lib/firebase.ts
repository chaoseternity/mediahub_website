import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD-PqWCqY4XX7bYPHn_ilKGpFUNDgWukkc",
  authDomain: "mediahub-web.firebaseapp.com",
  projectId: "mediahub-web",
  storageBucket: "mediahub-web.firebasestorage.app",
  messagingSenderId: "855382935345",
  appId: "1:855382935345:web:2bf9373f8f3d0bc42e5210",
  measurementId: "G-2D6GDKRCVE"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
