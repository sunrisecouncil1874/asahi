import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// ↓↓ ここにあなたのFirebase設定を貼り付けてください ↓↓
const firebaseConfig = {
  apiKey: "AIzaSyAmCpMBZVNH3PfxbasM9LCfWVWYfXZRA4Q",
  authDomain: "asahi-8c6c7.firebaseapp.com",
  projectId: "asahi-8c6c7",
  storageBucket: "asahi-8c6c7.firebasestorage.app",
  messagingSenderId: "461962250218",
  appId: "1:461962250218:web:0866034ff40ba9b5fb5493"
};
// ↑↑ ここまで ↑↑

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
