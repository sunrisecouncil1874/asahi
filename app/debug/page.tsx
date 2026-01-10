// #生徒用管理画面 (app/debug/page.tsx)
"use client";
import { useState, useEffect } from "react";
// 階層に合わせてパスを調整
import { db, auth } from "../../firebase"; 
import { collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";

// GoogleドライブのURLを自動変換する関数
const convertGoogleDriveLink = (url: string) => {
  if (!url) return "";
  if (!url.includes("drive.google.com") || url.includes("export=view")) {
    return url;
  }
  try {
    const id = url.split("/d/")[1].split("/")[0];
    return `https://drive.google.com/uc?export=view&id=${id}`;
  } catch (e) {
    return url;
  }
};

export default function AdminPage() {
  const [attractions, setAttractions] = useState<any[]>([]);
  
  // 自分のID（権限チェック・表示用）
  const [myUserId, setMyUserId] = useState("");

  // アカウント停止（BAN）状態管理
  const [isGlobalBanned, setIsGlobalBanned] = useState(false);

  // 表示モード管理
  const [expandedShopId, setExpandedShopId] = useState<string | null>(null); // 現在開いている会場ID
  const [isEditing, setIsEditing] = useState(false); // 編集モードか

  // 編集用フォームステート
  const [manualId, setManualId] = useState("");
  const [newName, setNewName] = useState("");
  const [department, setDepartment] = useState(""); 
  const [imageUrl, setImageUrl] = useState("");     
  const [description, setDescription] = useState(""); // 会場説明文
  const [password, setPassword] = useState("");
  
  const [groupLimit, setGroupLimit] = useState(4);
  const [openTime, setOpenTime] = useState("10:00");
  const [closeTime, setCloseTime] = useState("15:00");
  const [duration, setDuration] = useState(20);
  const [capacity, setCapacity] = useState(3);
  const [isPaused, setIsPaused] = useState(false);

  // ★追加: 運用モード（false: 時間予約制, true: 順番待ち制）
  const [isQueueMode, setIsQueueMode] = useState(false);

  // 検索用
  const [searchUserId, setSearchUserId] = useState("");

  useEffect(() => {
    signInAnonymously(auth).catch((e) => console.error(e));
    
    // --- IDの取得と生成ロジック ---
    let stored = localStorage.getItem("bunkasai_user_id");
    
    if (!stored) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let result = "";
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        stored = result;
        localStorage.setItem("bunkasai_user_id", stored);
    }
    
    setMyUserId(stored);
    // ------------------------------------------

    // 1. 会場データの監視
    const unsubAttractions = onSnapshot(collection(db, "attractions"), (snapshot) => {
      setAttractions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // 2. 自分のユーザーBAN状態をリアルタイム監視
    const unsubUser = onSnapshot(doc(db, "users", stored), (docSnap) => {
        if (docSnap.exists()) {
            const userData = docSnap.data();
            setIsGlobalBanned(!!userData.isBanned);
        } else {
            setIsGlobalBanned(false);
        }
    });

    return () => {
        unsubAttractions();
        unsubUser();
    };
  }, []);

  // --- 強制BAN画面 ---
  if (isGlobalBanned) {
      return (
          <div className="min-h-screen bg-black text-red-600 font-sans flex flex-col items-center justify-center p-6 text-center animate-fade-in">
              <div className="text-6xl mb-4">🚫</div>
              <h1 className="text-3xl font-bold mb-2">ACCESS DENIED</h1>
              <p className="text-white text-lg mb-6">
                  このアカウントは管理者により凍結されました。<br/>
                  すべての操作が無効化されています。
              </p>
              <div className="bg-gray-900 border border-gray-700 p-4 rounded text-sm text-gray-400 font-mono">
                  User ID: <span className="text-yellow-500">{myUserId}</span>
              </div>
          </div>
      );
  }

  // --- 権限チェックヘルパー関数 ---
  
  // 1. ブラックリスト判定 (trueならBANされている)
  const isUserBlacklisted = (shop: any) => {
      return shop?.adminBannedUsers?.includes(myUserId);
  };

  // 2. ホワイトリスト判定 (trueなら許可されていない)
  const isUserNotWhitelisted = (shop: any) => {
      // ホワイトリストモード(isRestricted)かつ、許可リスト(allowedUsers)に含まれていない場合
      if (shop.isRestricted) {
          return !shop.allowedUsers?.includes(myUserId);
      }
      return false;
  };

  // 3. 管理者限定モード判定 (trueなら許可されていない)
  const isAdminRestrictedAndNotAllowed = (shop: any) => {
      if (shop.isAdminRestricted) {
          return !shop.adminAllowedUsers?.includes(myUserId);
      }
      return false;
  };

  // --- 権限チェック付き: 会場展開 ---
  const handleExpandShop = (shopId: string) => {
      const shop = attractions.find(s => s.id === shopId);
      if (!shop) return;

      // --- 入室不可チェック ---
      if (isUserBlacklisted(shop)) {
          alert(`⛔ アクセス拒否\nあなたのIDは、この会場のブラックリストに含まれているため操作できません。`);
          return;
      }

      if (isUserNotWhitelisted(shop)) {
          alert(`🔒 アクセス制限\nこの会場は「ホワイトリスト（許可制）」です。\nあなたのIDは許可リストに入っていません。`);
          return;
      }

      if (isAdminRestrictedAndNotAllowed(shop)) {
          alert(`🔒 管理者制限\nこの会場は「指名スタッフ限定モード」です。\nアクセス権限がありません。`);
          return;
      }
      // ----------------------

      // パスワード認証 (入室前に必ず確認)
      const inputPass = prompt(`「${shop.name}」の管理用パスワードを入力してください`);
      if (inputPass !== shop.password) {
          alert("パスワードが違います");
          return;
      }

      setExpandedShopId(shopId);
  };

  // --- 編集関連 ---
  const resetForm = () => {
    setIsEditing(false);
    setManualId(""); setNewName(""); setDepartment(""); setImageUrl(""); setDescription(""); setPassword("");
    setGroupLimit(4); setOpenTime("10:00"); setCloseTime("15:00");
    setDuration(20); setCapacity(3); setIsPaused(false);
    setIsQueueMode(false); // 初期化
  };

  const startEdit = (shop: any) => {
    // 編集時も権限チェック
    if (isUserBlacklisted(shop) || isUserNotWhitelisted(shop)) return;

    setIsEditing(true);
    setManualId(shop.id); 
    setNewName(shop.name);
    setDepartment(shop.department || ""); 
    setImageUrl(shop.imageUrl || "");
    setDescription(shop.description || ""); 
    setPassword(shop.password);
    setGroupLimit(shop.groupLimit || 4); 
    setOpenTime(shop.openTime);
    setCloseTime(shop.closeTime); 
    setDuration(shop.duration);
    setCapacity(shop.capacity); 
    setIsPaused(shop.isPaused || false);
    setIsQueueMode(shop.isQueueMode || false); // モード読み込み
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSave = async () => {
    if (!isEditing) return alert("新規会場の作成は無効化されています。");

    const currentShop = attractions.find(s => s.id === manualId);
    
    // 保存時も権限チェック
    if (currentShop && (isUserBlacklisted(currentShop) || isUserNotWhitelisted(currentShop))) {
        return alert("権限がないため保存できません。");
    }

    if (!manualId || !newName || !password) return alert("必須項目を入力してください");
    if (password.length !== 5) return alert("パスワードは5桁です");

    let slots: any = {};
    let shouldResetSlots = true;

    // 時間予約制の場合のみスロット計算を行う
    if (!isQueueMode) {
        if (currentShop && currentShop.openTime === openTime && currentShop.closeTime === closeTime && currentShop.duration === duration) {
            slots = currentShop.slots;
            shouldResetSlots = false;
        } else {
            if(!confirm("時間を変更すると、現在の予約枠がリセットされます。よろしいですか？")) return;
        }

        if (shouldResetSlots) {
            let current = new Date(`2000/01/01 ${openTime}`);
            const end = new Date(`2000/01/01 ${closeTime}`);
            slots = {};
            while (current < end) {
                const timeStr = current.toTimeString().substring(0, 5);
                slots = { ...slots, [timeStr]: 0 };
                current.setMinutes(current.getMinutes() + duration);
            }
        }
    } else {
        // 順番待ちモードならスロットは既存維持か空にする（ここでは既存維持しつつモード優先）
        slots = currentShop?.slots || {}; 
    }

    const data: any = {
      name: newName, 
      department,
      imageUrl,
      description, 
      password, groupLimit,
      openTime, closeTime, duration, capacity, isPaused,
      isQueueMode, // ★保存
      slots // 予約制の場合は更新されたslots
    };

    await setDoc(doc(db, "attractions", manualId), data, { merge: true });
    
    alert("更新しました");
    setExpandedShopId(manualId);
    resetForm(); 
  };

  const handleDeleteVenue = async (id: string) => {
    const shop = attractions.find(s => s.id === id);
    if (shop && (isUserBlacklisted(shop) || isUserNotWhitelisted(shop))) return;

    if (!confirm("本当に会場を削除しますか？")) return;
    await deleteDoc(doc(db, "attractions", id));
    setExpandedShopId(null);
  };

  // --- 予約操作関連 (時間予約制用) ---
  const toggleReservationStatus = async (shop: any, res: any, newStatus: "reserved" | "used") => {
      if (isUserBlacklisted(shop) || isUserNotWhitelisted(shop)) return;
      if(!confirm(newStatus === "used" ? "入場済みにしますか？" : "入場を取り消して予約状態に戻しますか？")) return;

      const otherRes = shop.reservations.filter((r: any) => r.timestamp !== res.timestamp);
      const updatedRes = { ...res, status: newStatus };

      await updateDoc(doc(db, "attractions", shop.id), {
          reservations: [...otherRes, updatedRes]
      });
  };

  const cancelReservation = async (shop: any, res: any) => {
      if (isUserBlacklisted(shop) || isUserNotWhitelisted(shop)) return;
      if(!confirm(`User ID: ${res.userId}\nこの予約を削除しますか？`)) return;

      const otherRes = shop.reservations.filter((r: any) => r.timestamp !== res.timestamp);
      const updatedSlots = { ...shop.slots, [res.time]: Math.max(0, shop.slots[res.time] - 1) };

      await updateDoc(doc(db, "attractions", shop.id), {
          reservations: otherRes,
          slots: updatedSlots
      });
  };

  // --- ★追加: 順番待ち操作関連 (Queue System) ---
  const handleQueueAction = async (shop: any, ticket: any, action: "call" | "enter" | "cancel") => {
      if (isUserBlacklisted(shop) || isUserNotWhitelisted(shop)) return;

      let confirmMsg = "";
      if (action === "call") confirmMsg = `Ticket No.${ticket.ticketId}\n呼び出しを行いますか？（ユーザー画面が赤くなります）`;
      if (action === "enter") confirmMsg = `Ticket No.${ticket.ticketId}\n入場済みにしますか？（列から削除されます）`;
      if (action === "cancel") confirmMsg = `Ticket No.${ticket.ticketId}\n強制取り消ししますか？（列から削除されます）`;

      if (!confirm(confirmMsg)) return;

      const currentQueue = shop.queue || [];
      let updatedQueue = [];

      if (action === "call") {
          // ステータスを更新して維持
          updatedQueue = currentQueue.map((t: any) => 
              t.ticketId === ticket.ticketId ? { ...t, status: "ready" } : t
          );
      } else {
          // enter (強制入場) または cancel (強制取消) はリストから削除
          updatedQueue = currentQueue.filter((t: any) => t.ticketId !== ticket.ticketId);
      }

      await updateDoc(doc(db, "attractions", shop.id), {
          queue: updatedQueue
      });
  };

  // --- 表示用ヘルパー ---
  const targetShop = attractions.find(s => s.id === expandedShopId);

  const getReservationsByTime = (shop: any) => {
      const grouped: any = {};
      Object.keys(shop.slots || {}).sort().forEach(time => {
          grouped[time] = [];
      });
      if(shop.reservations) {
          shop.reservations.forEach((res: any) => {
              if(grouped[res.time]) {
                  grouped[res.time].push(res);
              }
          });
      }
      return grouped;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans">
      
      {/* ユーザーID表示バー (最上部) */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex justify-between items-center sticky top-0 z-50 shadow-md">
          <div className="text-xs text-gray-400">Logged in as:</div>
          <div className="font-mono font-bold text-yellow-400 text-lg tracking-wider">
              {myUserId || "---"}
          </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 pb-32">
        {/* ヘッダーエリア */}
        <div className="mb-6 border-b border-gray-700 pb-4">
            <h1 className="text-2xl font-bold text-white mb-4">予約管理</h1>
            
            {isEditing ? (
                <div className="bg-gray-800 rounded-lg p-4 border border-blue-500 mb-4 animate-fade-in shadow-lg shadow-blue-900/20">
                    <h3 className="text-sm font-bold mb-4 text-blue-300 flex items-center gap-2 border-b border-gray-700 pb-2">
                        <span>✏️ 設定編集モード</span>
                        <span className="text-gray-500 text-xs font-normal ml-auto">ID: {manualId}</span>
                    </h3>
                    
                    {/* ★★★ 入力フォーム（ラベル・説明付き） ★★★ */}

                    {/* 1. 変更不可情報（ID, Pass） */}
                    <div className="grid gap-4 md:grid-cols-2 mb-4 bg-gray-900/50 p-3 rounded border border-gray-700">
                        <div className="flex flex-col">
                            <label className="text-xs text-gray-500 mb-1">会場ID <span className="text-[10px] bg-gray-700 px-1 rounded text-gray-400">変更不可</span></label>
                            <input 
                                disabled 
                                className="bg-gray-800 p-2 rounded text-gray-400 cursor-not-allowed border border-gray-700 font-mono" 
                                value={manualId} 
                            />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-xs text-gray-500 mb-1">管理者Pass <span className="text-[10px] bg-gray-700 px-1 rounded text-gray-400">変更不可</span></label>
                            <input 
                                disabled 
                                className="bg-gray-800 p-2 rounded text-gray-400 cursor-not-allowed border border-gray-700 font-mono" 
                                value={password} 
                            />
                        </div>
                    </div>

                    {/* 2. 基本情報 */}
                    <div className="grid gap-4 md:grid-cols-2 mb-4">
                        <div className="flex flex-col">
                            <label className="text-xs text-gray-400 mb-1">会場名 <span className="text-red-500 text-[10px] border border-red-500/50 px-1 rounded ml-1">必須</span></label>
                            <input 
                                className="bg-gray-700 p-2 rounded text-white border border-gray-600 focus:border-blue-500 outline-none" 
                                placeholder="会場名" 
                                value={newName} 
                                onChange={e => setNewName(e.target.value)} 
                            />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-xs text-gray-500 mb-1">団体・クラス名 <span className="text-[10px] bg-gray-700 px-1 rounded text-gray-400">変更不可</span></label>
                            <input 
                                disabled 
                                className="bg-gray-800 p-2 rounded text-gray-400 cursor-not-allowed border border-gray-700" 
                                value={department} 
                            />
                        </div>
                    </div>

                    {/* 3. 画像URL */}
                    <div className="mb-4">
                        <div className="flex flex-col">
                            <label className="text-xs text-gray-400 mb-1">画像URL (Google Drive等) <span className="text-gray-500 text-[10px] border border-gray-600 px-1 rounded ml-1">任意</span></label>
                            <input 
                                className="bg-gray-700 p-2 rounded text-white border border-gray-600 focus:border-blue-500 outline-none w-full" 
                                placeholder="https://..." 
                                value={imageUrl} 
                                onChange={e => setImageUrl(convertGoogleDriveLink(e.target.value))} 
                            />
                        </div>
                    </div>

                    {/* 4. 説明文 (追加) */}
                    <div className="mb-4">
                      <label className="text-xs text-gray-400 mb-1 block">会場説明文 <span className="text-gray-500 text-[10px] border border-gray-600 px-1 rounded ml-1">任意</span> <span className="text-[10px] text-gray-500 ml-1">※最大500文字</span></label>
                      <textarea 
                          className="w-full bg-gray-700 p-2 rounded text-white h-24 text-sm border border-gray-600 focus:border-blue-500 outline-none resize-none"
                          placeholder="会場のアピールポイントや注意事項を入力してください。"
                          maxLength={500}
                          value={description}
                          onChange={e => setDescription(e.target.value)}
                      />
                      <div className="text-right text-xs text-gray-500">{description.length}/500</div>
                    </div>

                    {/* ★ 運用モード設定 ★ */}
                    <div className="bg-gray-750 p-3 rounded border border-gray-600 mb-4 bg-gray-900/30">
                         <h4 className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">Operation Mode</h4>
                         <div className="flex flex-wrap gap-4 items-center">
                            {/* モード切替スイッチ */}
                            <div className="flex items-center gap-2 bg-gray-800 px-3 py-2 rounded border border-gray-700">
                                <span className={`text-xs font-bold ${!isQueueMode ? "text-blue-400" : "text-gray-500"}`}>🕒 時間予約制</span>
                                <div className="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                                    <input type="checkbox" name="toggle" id="mode-toggle" 
                                        checked={isQueueMode} 
                                        onChange={(e) => setIsQueueMode(e.target.checked)}
                                        className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer transition-transform duration-200 ease-in-out"
                                        style={{ transform: isQueueMode ? 'translateX(100%)' : 'translateX(0)' }}
                                    />
                                    <label htmlFor="mode-toggle" className={`toggle-label block overflow-hidden h-5 rounded-full cursor-pointer ${isQueueMode ? "bg-green-600" : "bg-gray-600"}`}></label>
                                </div>
                                <span className={`text-xs font-bold ${isQueueMode ? "text-green-400" : "text-gray-500"}`}>🔢 順番待ち制</span>
                            </div>
                            
                            {/* 緊急停止スイッチ */}
                            <div className="flex items-center gap-2 bg-gray-800 px-3 py-2 rounded border border-gray-700">
                                <input type="checkbox" checked={isPaused} onChange={e => setIsPaused(e.target.checked)} className="accent-red-500 w-4 h-4 cursor-pointer" />
                                <span className={`text-xs font-bold ${isPaused ? "text-red-400" : "text-gray-400"}`}>⛔ 受付を緊急停止</span>
                            </div>
                        </div>
                    </div>

                    {/* 5. 時間・予約設定 (順番待ち制の場合は一部無効化などのUI制御も可能だが、今回はそのまま表示) */}
                    {!isQueueMode && (
                        <div className="bg-gray-750 p-3 rounded border border-gray-600 mb-4 bg-gray-900/30">
                            <h4 className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">Time Settings (予約制のみ)</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                                <div className="flex flex-col">
                                    <label className="text-[10px] text-gray-400 mb-1">開始時間 <span className="text-red-500">*</span></label>
                                    <input type="time" value={openTime} onChange={e => setOpenTime(e.target.value)} className="bg-gray-700 p-2 rounded text-sm outline-none border border-gray-600 focus:border-blue-500"/>
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-[10px] text-gray-400 mb-1">終了時間 <span className="text-red-500">*</span></label>
                                    <input type="time" value={closeTime} onChange={e => setCloseTime(e.target.value)} className="bg-gray-700 p-2 rounded text-sm outline-none border border-gray-600 focus:border-blue-500"/>
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-[10px] text-gray-400 mb-1">1枠の時間(分) <span className="text-red-500">*</span></label>
                                    <input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} className="bg-gray-700 p-2 rounded text-sm outline-none border border-gray-600 focus:border-blue-500" placeholder="分"/>
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-[10px] text-gray-400 mb-1">枠ごとの定員(組) <span className="text-red-500">*</span></label>
                                    <input type="number" value={capacity} onChange={e => setCapacity(Number(e.target.value))} className="bg-gray-700 p-2 rounded text-sm outline-none border border-gray-600 focus:border-blue-500" placeholder="定員"/>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {/* 人数制限は両方のモードで共通利用 */}
                    <div className="bg-gray-750 p-3 rounded border border-gray-600 mb-4 bg-gray-900/30 flex items-center gap-4">
                         <div className="flex flex-col">
                            <label className="text-[10px] text-gray-400 mb-1">1組の最大人数</label>
                            <input type="number" value={groupLimit} onChange={e => setGroupLimit(Number(e.target.value))} className="w-20 bg-gray-700 p-2 rounded text-sm outline-none text-center border border-gray-600 focus:border-blue-500" />
                         </div>
                    </div>

                    <div className="flex gap-2">
                        <button onClick={handleSave} className="flex-1 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 py-3 rounded font-bold transition shadow-lg shadow-blue-900/40">変更を保存</button>
                        <button onClick={resetForm} className="bg-gray-700 hover:bg-gray-600 px-6 rounded text-sm transition border border-gray-600">キャンセル</button>
                    </div>
                </div>
            ) : (
                <div className="bg-gray-800/50 rounded p-3 mb-4 border border-gray-700 text-center text-xs text-gray-500">
                    ※設定を変更するには、下のリストから会場を選び「設定編集」ボタンを押してください。
                </div>
            )}

            {/* ユーザーID検索 */}
            <div className="flex gap-2 items-center bg-gray-800 p-2 rounded border border-gray-600">
                <span className="text-xl">🔍</span>
                <input 
                    className="flex-1 bg-transparent text-white outline-none" 
                    placeholder="ユーザーIDまたはチケットID(6桁)を入力" 
                    value={searchUserId} 
                    onChange={e => setSearchUserId(e.target.value)} 
                />
                {searchUserId && (
                    <div className="text-xs text-pink-400 font-bold animate-pulse">
                        ※該当チケットをハイライトします
                    </div>
                )}
            </div>
        </div>

        {/* --- メインエリア --- */}

        {/* 1. 一覧モード（詳細が開かれていない時） */}
        {!expandedShopId && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {attractions.map(shop => {
                    // 検索ヒット判定：予約(reservations)または待機列(queue)
                    const hitInRes = shop.reservations?.some((r:any) => r.userId?.includes(searchUserId.toUpperCase()));
                    const hitInQueue = shop.queue?.some((q:any) => q.userId?.includes(searchUserId.toUpperCase()) || q.ticketId?.includes(searchUserId.toUpperCase()));
                    const hasUser = searchUserId && (hitInRes || hitInQueue);
                    
                    const blacklisted = isUserBlacklisted(shop);     // ブラックリストに入っている
                    const notWhitelisted = isUserNotWhitelisted(shop); // ホワイトリストモードなのにリストにいない
                    const adminRestricted = isAdminRestrictedAndNotAllowed(shop); // 管理者モード制限

                    const isLocked = blacklisted || notWhitelisted || adminRestricted;

                    return (
                        <button 
                            key={shop.id} 
                            onClick={() => handleExpandShop(shop.id)} 
                            className={`group p-4 rounded-xl border text-left flex items-start gap-4 transition hover:bg-gray-800 relative overflow-hidden
                                ${hasUser ? 'bg-pink-900/40 border-pink-500' : 'bg-gray-800 border-gray-600'}
                                ${isLocked ? 'opacity-70 bg-gray-900 grayscale' : ''}
                            `}
                        >
                            {/* 画像サムネイル (あれば) */}
                            {shop.imageUrl ? (
                                <img src={shop.imageUrl} alt="" className="w-16 h-16 rounded object-cover bg-gray-700 flex-shrink-0" />
                            ) : (
                                <div className="w-16 h-16 rounded bg-gray-700 flex items-center justify-center text-2xl flex-shrink-0">🎪</div>
                            )}

                            <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                    <span className="text-yellow-400 font-bold font-mono text-xl">{shop.id}</span>
                                    
                                    {/* 団体名バッジ */}
                                    {shop.department && (
                                        <span className="text-xs bg-blue-900/50 text-blue-200 px-2 py-0.5 rounded border border-blue-800/50 truncate max-w-[100px]">
                                            {shop.department}
                                        </span>
                                    )}

                                    {/* 状態表示 */}
                                    {blacklisted && <span className="text-xs bg-red-900 text-red-200 border border-red-700 px-2 py-0.5 rounded font-bold">⛔ BAN指定</span>}
                                    {notWhitelisted && <span className="text-xs bg-gray-700 text-gray-300 border border-gray-500 px-2 py-0.5 rounded font-bold">🔒 許可外</span>}
                                    {(!blacklisted && !notWhitelisted && adminRestricted) && <span className="text-xs bg-purple-900 text-purple-200 border border-purple-700 px-2 py-0.5 rounded font-bold">🛡️ スタッフ限</span>}
                                    
                                    {/* 運用モードバッジ */}
                                    {shop.isQueueMode ? (
                                        <span className="text-xs bg-green-900/60 text-green-300 border border-green-700 px-2 py-0.5 rounded">🔢 順番待ち</span>
                                    ) : (
                                        <span className="text-xs bg-blue-900/60 text-blue-300 border border-blue-700 px-2 py-0.5 rounded">🕒 時間予約</span>
                                    )}
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-lg truncate w-full">{shop.name}</span>
                                    {shop.isPaused && <span className="text-xs bg-red-600 px-2 py-0.5 rounded text-white whitespace-nowrap">停止中</span>}
                                </div>
                                <div className="text-xs text-gray-400 mt-1">
                                    {shop.isQueueMode ? (
                                        <span>待機: {shop.queue?.length || 0}組</span>
                                    ) : (
                                        <span>予約: {shop.reservations?.length || 0}件</span>
                                    )}
                                </div>
                            </div>

                            <div className="self-center text-gray-400 text-2xl group-hover:text-white transition-transform group-hover:translate-x-1">
                                ›
                            </div>
                        </button>
                    );
                })}
            </div>
        )}

        {/* 2. 詳細モード（会場が選択された時） */}
        {expandedShopId && targetShop && (
            <div className="animate-fade-in">
                {/* 戻るヘッダー */}
                <button onClick={() => { setExpandedShopId(null); setIsEditing(false); }} className="mb-4 flex items-center gap-2 text-gray-400 hover:text-white">
                    ← 会場一覧に戻る
                </button>

                <div className="bg-gray-800 rounded-xl border border-gray-600 overflow-hidden">
                    {/* タイトルバー */}
                    <div className="bg-gray-700 p-4 flex justify-between items-start relative overflow-hidden">
                        {/* 背景画像(あれば薄く表示) */}
                        {targetShop.imageUrl && (
                            <div className="absolute inset-0 z-0 opacity-20">
                                <img src={targetShop.imageUrl} className="w-full h-full object-cover" alt="" />
                            </div>
                        )}

                        <div className="relative z-10">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-yellow-400 font-mono font-bold text-xl">{targetShop.id}</span>
                                {targetShop.department && (
                                    <span className="text-xs bg-black/50 text-white px-2 py-0.5 rounded backdrop-blur-sm border border-white/20">
                                        {targetShop.department}
                                    </span>
                                )}
                                <span className={`text-xs px-2 py-0.5 rounded border backdrop-blur-sm ${targetShop.isQueueMode ? "bg-green-600/50 border-green-400 text-white" : "bg-blue-600/50 border-blue-400 text-white"}`}>
                                    {targetShop.isQueueMode ? "順番待ち制" : "時間予約制"}
                                </span>
                            </div>
                            <h2 className="text-2xl font-bold flex items-center gap-2 text-white drop-shadow-md">
                                {targetShop.name}
                            </h2>
                            <p className="text-xs text-gray-300 mt-1 drop-shadow-md">Pass: **** | 定員: {targetShop.capacity}組</p>
                        </div>

                        <div className="flex gap-2 relative z-10">
                            <button onClick={() => startEdit(targetShop)} className="bg-blue-600 text-xs px-3 py-2 rounded hover:bg-blue-500 font-bold shadow-lg">⚙️ 設定編集</button>
                            <button onClick={() => handleDeleteVenue(targetShop.id)} className="bg-red-600 text-xs px-3 py-2 rounded hover:bg-red-500 shadow-lg">削除</button>
                        </div>
                    </div>

                    <div className="p-4 space-y-6">
                        {/* 説明文表示 */}
                        {targetShop.description && (
                            <div className="bg-gray-700/50 p-4 rounded-lg border border-gray-600 text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                                {targetShop.description}
                            </div>
                        )}

                        {/* ★★★ 運用モードによる分岐 ★★★ */}
                        
                        {targetShop.isQueueMode ? (
                            /* --- A. 順番待ち制 (Queue List) --- */
                            <div className="bg-gray-900/50 rounded-lg border border-gray-700 overflow-hidden">
                                <div className="bg-gray-700 px-4 py-2 border-b border-gray-600 flex items-center justify-between">
                                    <h3 className="font-bold text-green-400 flex items-center gap-2">
                                        <span>📋 待機列リスト</span>
                                        <span className="text-xs text-white bg-gray-600 px-2 py-0.5 rounded-full">{targetShop.queue?.length || 0}組待ち</span>
                                    </h3>
                                </div>
                                
                                {(!targetShop.queue || targetShop.queue.length === 0) ? (
                                    <div className="p-8 text-center text-gray-500">現在の待機列はありません</div>
                                ) : (
                                    <div className="divide-y divide-gray-700">
                                        {/* ヘッダー行 (スマホでは非表示にしてCard形式にする手もあるが、今回はリスト風) */}
                                        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-gray-400 font-bold bg-gray-800">
                                            <div className="col-span-1">No.</div>
                                            <div className="col-span-3">Ticket / User</div>
                                            <div className="col-span-2 text-center">人数</div>
                                            <div className="col-span-2 text-center">Status</div>
                                            <div className="col-span-4 text-center">Action</div>
                                        </div>

                                        {targetShop.queue.map((ticket: any, index: number) => {
                                            // 検索マッチング（TicketID優先、UserIDも可）
                                            const isMatch = searchUserId && (
                                                ticket.ticketId?.includes(searchUserId.toUpperCase()) || 
                                                ticket.userId?.includes(searchUserId.toUpperCase())
                                            );

                                            const isCalled = ticket.status === "ready";

                                            return (
                                                <div key={ticket.ticketId} className={`grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-gray-800/50 transition ${isMatch ? 'bg-pink-900/20 ring-1 ring-pink-500 inset-0' : ''}`}>
                                                    {/* No. */}
                                                    <div className="col-span-1 text-lg font-bold text-gray-500 font-mono">
                                                        {index + 1}
                                                    </div>

                                                    {/* ID & User */}
                                                    <div className="col-span-3">
                                                        <div className="text-lg font-bold text-yellow-400 font-mono tracking-wider">
                                                            {ticket.ticketId}
                                                        </div>
                                                        <div className="text-[10px] text-gray-500 font-mono truncate">
                                                            UID: {ticket.userId}
                                                        </div>
                                                    </div>

                                                    {/* 人数 */}
                                                    <div className="col-span-2 text-center">
                                                        <span className="bg-gray-700 px-2 py-1 rounded text-sm font-bold text-white">
                                                            {ticket.count}名
                                                        </span>
                                                    </div>

                                                    {/* Status */}
                                                    <div className="col-span-2 text-center">
                                                        {isCalled ? (
                                                            <span className="text-xs bg-red-600 text-white px-2 py-1 rounded font-bold animate-pulse">
                                                                呼び出し中
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs bg-blue-900 text-blue-200 px-2 py-1 rounded">
                                                                待機中
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="col-span-4 flex justify-end gap-1">
                                                        {/* Call Button */}
                                                        {!isCalled && (
                                                            <button 
                                                                onClick={() => handleQueueAction(targetShop, ticket, "call")}
                                                                className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-2 py-1.5 rounded font-bold shadow-sm"
                                                            >
                                                                Call
                                                            </button>
                                                        )}
                                                        
                                                        {/* Enter (Force) */}
                                                        <button 
                                                            onClick={() => handleQueueAction(targetShop, ticket, "enter")}
                                                            className="bg-green-700 hover:bg-green-600 text-white text-xs px-2 py-1.5 rounded font-bold shadow-sm"
                                                            title="パスワードなしで入場済みにします"
                                                        >
                                                            入場
                                                        </button>

                                                        {/* Cancel (Force) */}
                                                        <button 
                                                            onClick={() => handleQueueAction(targetShop, ticket, "cancel")}
                                                            className="bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white text-xs px-2 py-1.5 rounded transition"
                                                            title="列から削除します"
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* --- B. 時間予約制 (Time Slots) - 既存ロジック --- */
                            <div className="space-y-6">
                                {Object.entries(getReservationsByTime(targetShop)).map(([time, reservations]: any) => {
                                    const slotCount = targetShop.slots[time] || 0;
                                    const isFull = slotCount >= targetShop.capacity;

                                    return (
                                        <div key={time} className={`border rounded-lg p-3 ${isFull ? 'border-red-500/50 bg-red-900/10' : 'border-gray-600 bg-gray-900/50'}`}>
                                            {/* 時間ヘッダー */}
                                            <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-2">
                                                <h3 className="font-bold text-lg text-blue-300">{time}</h3>
                                                <span className={`text-sm font-bold ${isFull ? 'text-red-400' : 'text-green-400'}`}>
                                                    予約: {slotCount} / {targetShop.capacity}
                                                </span>
                                            </div>

                                            {/* 予約者リスト */}
                                            <div className="space-y-2">
                                                {reservations.length === 0 && <p className="text-xs text-gray-500 text-center py-1">予約なし</p>}
                                                
                                                {reservations.map((res: any) => {
                                                    const isMatch = searchUserId && res.userId?.includes(searchUserId.toUpperCase());
                                                    
                                                    return (
                                                        <div key={res.timestamp} className={`flex justify-between items-center p-2 rounded ${res.status === 'used' ? 'bg-gray-800 opacity-60' : 'bg-gray-700'} ${isMatch ? 'ring-2 ring-pink-500' : ''}`}>
                                                            <div>
                                                                <div className="font-mono font-bold text-yellow-400 flex items-center">
                                                                    <span>ID: {res.userId}</span>
                                                                    <span className="ml-2 text-sm text-white font-normal bg-gray-600 px-2 py-0.5 rounded-full">
                                                                        {res.count || 1}名
                                                                    </span>
                                                                </div>
                                                                <div className="text-xs text-gray-300 mt-1">
                                                                    {res.status === 'used' ? '✅ 入場済' : '🔵 予約中'}
                                                                </div>
                                                            </div>
                                                            
                                                            <div className="flex gap-1">
                                                                {res.status !== 'used' ? (
                                                                    <>
                                                                        <button onClick={() => toggleReservationStatus(targetShop, res, "used")} className="bg-green-600 text-xs px-3 py-1.5 rounded font-bold hover:bg-green-500">入場</button>
                                                                        <button onClick={() => cancelReservation(targetShop, res)} className="bg-red-600 text-xs px-3 py-1.5 rounded hover:bg-red-500">取消</button>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                         <button onClick={() => toggleReservationStatus(targetShop, res, "reserved")} className="bg-gray-600 text-xs px-3 py-1.5 rounded hover:bg-gray-500">戻す</button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}
