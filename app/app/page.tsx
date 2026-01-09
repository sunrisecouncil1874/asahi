// ＃予約画面 (app/page.tsx)
"use client";
import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, onSnapshot, doc, updateDoc, arrayUnion, arrayRemove, increment, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";

type Ticket = {
  shopId: string;
  shopName: string;
  time: string;
  timestamp: number;
  status: "reserved" | "used";
};

export default function Home() {
  const [attractions, setAttractions] = useState<any[]>([]);
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [selectedShop, setSelectedShop] = useState<any | null>(null);
  const [userId, setUserId] = useState("");
  // BAN状態管理用のステート
  const [isBanned, setIsBanned] = useState(false);

  useEffect(() => {
    signInAnonymously(auth).catch((e) => console.error(e));
    
    // 1. ユーザーIDの生成・取得
    let storedId = localStorage.getItem("bunkasai_user_id");
    if (!storedId) {
      storedId = Math.random().toString(36).substring(2, 8).toUpperCase();
      localStorage.setItem("bunkasai_user_id", storedId);
    }
    setUserId(storedId);

    // ============================================================
    // ★ 追加機能: ユーザーDBへの自動保存 & BAN監視
    // ============================================================
    const userDocRef = doc(db, "users", storedId);

    // A. 初回チェック: DBになければ作成 (ID保存)
    getDoc(userDocRef).then((snap) => {
        if (!snap.exists()) {
            setDoc(userDocRef, {
                userId: storedId,
                createdAt: serverTimestamp(),
                nickname: "",       // 管理者が後で編集可能
                isPinned: false,    // ピン留め用
                isBanned: false     // 垢バンフラグ
            }).catch(err => console.error("User regist error:", err));
        }
    });

    // B. リアルタイム監視: BANされているかチェック
    const unsubUser = onSnapshot(userDocRef, (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            // 管理画面で isBanned が true になると即座に反映
            setIsBanned(data.isBanned === true);
        }
    });
    // ============================================================


    // 3. データのリアルタイム取得 (Attractions)
    const unsubAttractions = onSnapshot(collection(db, "attractions"), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setAttractions(data);

      const myFoundTickets: Ticket[] = [];
      data.forEach((shop: any) => {
        if (shop.reservations) {
          shop.reservations.forEach((r: any) => {
            if (r.userId === storedId) {
              myFoundTickets.push({
                shopId: shop.id,
                shopName: shop.name,
                time: r.time,
                timestamp: r.timestamp,
                status: r.status
              });
            }
          });
        }
      });
      myFoundTickets.sort((a, b) => b.timestamp - a.timestamp);
      setMyTickets(myFoundTickets);
    });

    return () => {
        unsubUser();        // ユーザー監視解除
        unsubAttractions(); // 会場監視解除
    };
  }, []);

  const activeTickets = myTickets.filter(t => t.status === "reserved");
  const usedTickets = myTickets.filter(t => t.status === "used");

  // ============================================================
  // ★ BANされている場合の表示 (操作を完全にブロック)
  // ============================================================
  if (isBanned) {
      return (
          <div className="min-h-screen bg-red-900 text-white flex flex-col items-center justify-center p-4 text-center">
              <div className="text-6xl mb-4">🚫</div>
              <h1 className="text-3xl font-bold mb-2">ACCESS DENIED</h1>
              <p className="font-bold text-lg mb-4">利用停止処分が適用されています</p>
              <p className="text-sm opacity-80">
                  あなたのID ({userId}) は管理者により操作が制限されています。<br/>
                  誤りだと思われる場合は実行委員会へお問い合わせください。
              </p>
          </div>
      );
  }

  const handleBook = async (shop: any, time: string) => {
    // --- 店舗ごとの制限チェック ---
    
    // 1. 店舗別BANチェック
    if (shop.bannedUsers && shop.bannedUsers.includes(userId)) {
        return alert("申し訳ありませんが、この店舗の利用は管理者により制限されています。");
    }

    // 2. 制限モード(招待制)チェック
    if (shop.isRestricted) {
        const allowedList = shop.allowedUsers || [];
        if (!allowedList.includes(userId)) {
            return alert("🔒 この時間は招待されたお客様のみ予約可能です。\n(制限モード)");
        }
    }
    // ----------------------------------

    if (activeTickets.length >= 3) return alert("同時に持てる予約は3つまでです！\n入場又はキャンセルすると枠が空きます。");
    if (activeTickets.some(t => t.shopId === shop.id && t.time === time)) return alert("すでに同じ時間を予約済みです！");
    if (shop.slots[time] >= shop.capacity) return alert("満席です。");
    if (shop.isPaused) return alert("現在、受付を停止しています。");
    
    if (!confirm(`${shop.name} ${time}〜\n予約しますか？`)) return;

    try {
      const timestamp = Date.now();
      const reservationData = { userId, time, timestamp, status: "reserved" };

      await updateDoc(doc(db, "attractions", shop.id), { 
        [`slots.${time}`]: increment(1),
        reservations: arrayUnion(reservationData)
      });
      
      setSelectedShop(null);
      alert("予約しました！");
    } catch (e) { 
      console.error(e);
      alert("エラーが発生しました。"); 
    }
  };

  const handleCancel = async (ticket: Ticket) => {
    if (!confirm("キャンセルしますか？")) return;
    try {
      const shopRef = doc(db, "attractions", ticket.shopId);
      const shopSnap = await getDoc(shopRef);
      if (!shopSnap.exists()) return;
      const shopData = shopSnap.data();
      const targetRes = shopData.reservations?.find((r: any) => r.userId === userId && r.time === ticket.time && r.timestamp === ticket.timestamp);

      if (targetRes) {
        await updateDoc(shopRef, { 
          [`slots.${ticket.time}`]: increment(-1),
          reservations: arrayRemove(targetRes)
        });
        alert("キャンセルしました");
      }
    } catch (e) { alert("キャンセル失敗"); }
  };

  const handleEnter = async (ticket: Ticket) => {
    const shop = attractions.find(s => s.id === ticket.shopId);
    if (!shop) return alert("データが見つかりません");

    const inputPass = prompt(`${shop.name}のスタッフパスワード(5桁)を入力：`);
    if (inputPass === null) return;

    if (inputPass === shop.password) {
      try {
        const oldRes = shop.reservations.find((r: any) => r.userId === userId && r.time === ticket.time && r.status === "reserved");
        if(oldRes) {
            await updateDoc(doc(db, "attractions", shop.id), {
                reservations: arrayRemove(oldRes)
            });
            await updateDoc(doc(db, "attractions", shop.id), {
                reservations: arrayUnion({ ...oldRes, status: "used" })
            });
        }
        alert("認証成功！入場しました。");
      } catch(e) {
        alert("通信エラーが発生しましたが、入場はOKです。");
      }
    } else {
      alert("パスワードが違います！");
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 bg-gray-50 min-h-screen pb-20">
      <header className="mb-6">
        <div className="flex justify-between items-center mb-2">
           <h1 className="text-xl font-bold text-blue-900">予約システム</h1>
           <div className={`px-3 py-1 rounded-full text-sm font-bold ${activeTickets.length >= 3 ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>
               予約: {activeTickets.length}/3
           </div>
        </div>
        <div className="bg-gray-800 text-white text-center py-2 rounded-lg font-mono tracking-widest shadow-md">
            ID: <span className="text-yellow-400 font-bold text-lg">{userId}</span>
        </div>
      </header>

      {/* 1. 有効なチケットエリア */}
      {activeTickets.length > 0 && (
        <div className="mb-8 space-y-4">
          <p className="text-blue-900 text-sm font-bold flex items-center gap-1">
              🎟️ 現在の予約チケット
          </p>
          {activeTickets.map((t) => (
            <div key={t.timestamp} className="bg-white border-l-4 border-green-500 p-4 rounded shadow-lg relative overflow-hidden">
              <div className="flex justify-between items-center mb-3">
                <div>
                    <h2 className="font-bold text-lg flex items-center">
                        {t.shopName}
                    </h2>
                    <p className="text-3xl font-bold text-blue-600 font-mono">{t.time}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleEnter(t)} className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-lg shadow hover:bg-blue-500 transition">
                  入場画面へ
                </button>
                <button onClick={() => handleCancel(t)} className="px-4 text-red-500 border border-red-200 rounded-lg text-xs hover:bg-red-50">
                  キャンセル
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 2. 出し物一覧 / 詳細 */}
      {!selectedShop ? (
        <div className="space-y-3">
          <p className="text-sm font-bold text-gray-600 mb-2 border-b pb-2">新しく予約する</p>
          {attractions.map((shop) => (
            <button key={shop.id} onClick={() => setSelectedShop(shop)} className={`w-full bg-white p-3 rounded-xl shadow-sm border text-left flex items-start gap-3 hover:bg-gray-50 transition ${shop.isPaused ? 'opacity-60 grayscale' : ''}`}>
              
              {/* サムネイル画像エリア（画像がない場合は表示しない） */}
              {shop.imageUrl && (
                  <div className="w-20 h-20 bg-gray-200 rounded-lg overflow-hidden flex-shrink-0 relative">
                      <img src={shop.imageUrl} alt="" className="w-full h-full object-cover" />
                  </div>
              )}

              <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1 mb-1">
                      {shop.department && (
                          <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded border border-blue-200 truncate max-w-full">
                              {shop.department}
                          </span>
                      )}
                      {shop.isPaused && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded">受付停止中</span>}
                      {shop.isRestricted && <span className="bg-purple-600 text-white text-[10px] px-2 py-0.5 rounded">招待制</span>}
                  </div>
                  
                  <h3 className="font-bold text-lg leading-tight truncate text-gray-800 mb-1">
                      {shop.name}
                  </h3>
                  
                  <div className="text-xs text-gray-400">
                      {shop.openTime} - {shop.closeTime} / 定員: {shop.groupLimit || shop.capacity}名
                  </div>
              </div>
              
              <div className="self-center text-gray-300">
                  &gt;
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            {/* 詳細ヘッダー */}
            <div className="relative">
                {selectedShop.imageUrl && (
                    <div className="w-full h-40 bg-gray-200">
                        <img src={selectedShop.imageUrl} alt="" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>
                    </div>
                )}
                
                <button onClick={() => setSelectedShop(null)} className="absolute top-2 left-2 bg-black/60 text-white px-3 py-1 rounded-full text-sm backdrop-blur-sm z-10">
                    ← もどる
                </button>

                {/* ▼▼▼ 変更点: 画像がない時は上部パディング(pt-12)を増やしてボタンとの重なりを防ぐ ▼▼▼ */}
                <div className={`${selectedShop.imageUrl ? "absolute bottom-0 left-0 right-0 p-4 text-white" : "pt-12 px-4 pb-4 text-gray-800 border-b"}`}>
                    {selectedShop.department && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded mb-1 inline-block ${selectedShop.imageUrl ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-800"}`}>
                            {selectedShop.department}
                        </span>
                    )}
                    <h2 className="text-2xl font-bold leading-tight">
                        {selectedShop.name}
                    </h2>
                </div>
            </div>

            <div className="p-4">
                {/* 説明文表示エリア */}
                {selectedShop.description && (
                    <div className="mb-6 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 p-3 rounded-lg border border-gray-100">
                        {selectedShop.description}
                    </div>
                )}

                {selectedShop.isRestricted && (
                    <div className="mb-4 bg-purple-50 border border-purple-200 text-purple-800 px-3 py-2 rounded text-sm flex items-center gap-2">
                        <span>🔒</span>
                        <span>招待制モード有効中</span>
                    </div>
                )}

                {selectedShop.isPaused ? (
                    <p className="text-red-500 font-bold mb-4 bg-red-100 p-3 rounded text-center border border-red-200">
                        現在、新規の受付を停止しています
                    </p>
                ) : (
                    <>
                        <p className="text-gray-500 mb-4 text-sm flex items-center gap-2">
                            <span>🕒 以下の時間枠から選択してください</span>
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                            {Object.entries(selectedShop.slots || {}).sort().map(([time, count]: any) => {
                            const isFull = count >= selectedShop.capacity;
                            const isBooked = activeTickets.some(t => t.shopId === selectedShop.id && t.time === time);
                            const remaining = selectedShop.capacity - count;
                            
                            // 招待制の場合、リストに入っていなければdisabledにする
                            const isNotAllowed = selectedShop.isRestricted && (!selectedShop.allowedUsers || !selectedShop.allowedUsers.includes(userId));

                            return (
                                <button key={time} disabled={isFull || isBooked || selectedShop.isPaused || isNotAllowed} onClick={() => handleBook(selectedShop, time)}
                                className={`p-2 rounded border h-24 flex flex-col items-center justify-center transition relative overflow-hidden
                                    ${isFull || selectedShop.isPaused || isNotAllowed 
                                        ? "bg-gray-100 text-gray-300 border-gray-200" 
                                        : isBooked 
                                            ? "bg-green-50 border-green-500 text-green-700" 
                                            : "bg-white border-blue-200 text-blue-900 shadow-sm hover:border-blue-400"
                                    }`}
                                >
                                <span className="text-xl font-bold mb-1 z-10">{time}</span>
                                <span className="text-xs font-bold z-10">
                                    {isBooked ? "予約済" : isNotAllowed ? "招待のみ" : isFull ? "満席" : `あと${remaining}組`}
                                </span>
                                {!isFull && !isBooked && !isNotAllowed && remaining <= 2 && (
                                    <div className="absolute top-0 right-0 w-3 h-3 bg-red-400 rounded-bl-full"></div>
                                )}
                                </button>
                            );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
      )}

      {/* 3. 入場済み履歴エリア */}
      {usedTickets.length > 0 && (
        <div className="mt-12 mb-8">
            <details className="group">
                <summary className="text-gray-400 text-xs text-center cursor-pointer list-none flex justify-center items-center gap-2 mb-2 hover:text-gray-600">
                    📂 入場済みの履歴を見る ({usedTickets.length})
                </summary>
                <div className="space-y-2 pl-2 border-l-2 border-gray-200 mt-2">
                    {usedTickets.map((t) => (
                        <div key={t.timestamp} className="bg-gray-100 p-3 rounded opacity-70 grayscale flex justify-between items-center">
                            <div>
                                <h2 className="font-bold text-sm text-gray-600 flex items-center">
                                    {t.shopName}
                                </h2>
                                <p className="text-sm font-bold text-gray-500">{t.time}</p>
                            </div>
                            <div className="text-xs font-bold text-white bg-gray-400 px-2 py-1 rounded">
                                入場済
                            </div>
                        </div>
                    ))}
                </div>
            </details>
        </div>
      )}

      <div className="mt-8 text-center border-t pt-4"><a href="/debugG" className="text-xs text-gray-300">/debug</a></div>
    </div>
  );
}
