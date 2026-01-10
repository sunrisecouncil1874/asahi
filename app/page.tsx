// ＃予約画面 (app/page.tsx)
// app/page.tsx
"use client";
import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, onSnapshot, doc, updateDoc, arrayUnion, arrayRemove, increment, getDoc, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";

// 型定義
type Ticket = {
  uniqueKey: string;
  shopId: string;
  shopName: string;
  time: string;
  timestamp: number;
  status: "reserved" | "waiting" | "ready" | "used" | "done";
  count: number;
  isQueue?: boolean;
  ticketId?: string;
  peopleAhead?: number; // ここには「待ち組数」が入ります
};

export default function Home() {
  const [attractions, setAttractions] = useState<any[]>([]);
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [selectedShop, setSelectedShop] = useState<any | null>(null);
  const [userId, setUserId] = useState("");
  const [isBanned, setIsBanned] = useState(false);

  // 申し込み画面用の状態
  // maxPeopleを追加: そのチケットで選択できる最大人数
  const [draftBooking, setDraftBooking] = useState<{ time: string; remaining: number; mode: "slot" | "queue"; maxPeople: number } | null>(null);
  const [peopleCount, setPeopleCount] = useState<number>(1);

  // 1. 初期化とデータ監視
  useEffect(() => {
    signInAnonymously(auth).catch((e) => console.error(e));
    
    // ユーザーIDの確保
    let storedId = localStorage.getItem("bunkasai_user_id");
    if (!storedId) {
      storedId = Math.random().toString(36).substring(2, 8).toUpperCase();
      localStorage.setItem("bunkasai_user_id", storedId);
    }
    setUserId(storedId);

    // ユーザー情報の監視
    const userDocRef = doc(db, "users", storedId);
    getDoc(userDocRef).then((snap) => {
        if (!snap.exists()) {
            setDoc(userDocRef, {
                userId: storedId,
                createdAt: serverTimestamp(),
                isBanned: false        
            }).catch(err => console.error("User regist error:", err));
        }
    });
    const unsubUser = onSnapshot(userDocRef, (snap) => {
        if (snap.exists()) setIsBanned(snap.data().isBanned === true);
    });

    // アトラクション情報の監視
    const unsubAttractions = onSnapshot(collection(db, "attractions"), (snapshot) => {
      const shopData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setAttractions(shopData);

      // チケット情報の構築
      const newMyTickets: Ticket[] = [];
      
      shopData.forEach((shop: any) => {
        // A. 時間枠予約 (Slots) を探す
        if (shop.reservations) {
          shop.reservations.forEach((r: any) => {
            if (r.userId === storedId) {
              newMyTickets.push({
                uniqueKey: `slot_${shop.id}_${r.time}`,
                shopId: shop.id,
                shopName: shop.name,
                time: r.time,
                timestamp: r.timestamp,
                status: r.status,
                count: r.count || 1,
                isQueue: false
              });
            }
          });
        }

        // B. 順番待ち (Queue) を探す
        if (shop.queue) {
          shop.queue.forEach((q: any) => {
            if (q.userId === storedId) {
              // ▼▼▼ 修正: 自分より前の「組数」を計算 ▼▼▼
              let groupsAhead = 0;
              if (q.status === 'waiting') {
                const myNum = parseInt(q.ticketId || "999999");
                // filterで抽出した後、lengthで「組数」を取得 (以前はreduceで人数合計していた)
                groupsAhead = shop.queue.filter((other: any) => 
                  other.status === 'waiting' && parseInt(other.ticketId || "999999") < myNum
                ).length;
              }
              // ▲▲▲ 修正終わり ▲▲▲

              newMyTickets.push({
                uniqueKey: `queue_${shop.id}_${q.ticketId}`,
                shopId: shop.id,
                shopName: shop.name,
                time: "順番待ち",
                timestamp: q.createdAt?.toMillis() || Date.now(),
                status: q.status,
                count: q.count || 1,
                isQueue: true,
                ticketId: q.ticketId,
                peopleAhead: groupsAhead // 変数名は peopleAhead のままですが、中身は組数
              });
            }
          });
        }
      });

      // 並び替え
      newMyTickets.sort((a, b) => {
        if (a.status === 'ready' && b.status !== 'ready') return -1;
        if (a.status !== 'ready' && b.status === 'ready') return 1;
        return b.timestamp - a.timestamp;
      });

      setMyTickets(newMyTickets);
    });

    return () => {
        unsubUser();        
        unsubAttractions(); 
    };
  }, []);

  const activeTickets = myTickets.filter(t => ["reserved", "waiting", "ready"].includes(t.status));

  // BAN画面
  if (isBanned) {
      return (
          <div className="min-h-screen bg-red-900 text-white flex flex-col items-center justify-center p-4 text-center">
              <h1 className="text-3xl font-bold mb-2">ACCESS DENIED</h1>
              <p>利用停止処分が適用されています</p>
          </div>
      );
  }

  // ▼▼▼ 修正: 時間選択（予約）ロジック ▼▼▼
  const handleSelectTime = (shop: any, time: string) => {
    if (activeTickets.length >= 3) return alert("チケットは3枚までです。");
    if (activeTickets.some(t => t.shopId === shop.id && t.time === time)) return alert("既に予約済みです。");
    
    // 定員の計算: groupLimit (枠ごとの定員・組) を使用
    const limitGroups = shop.groupLimit || 0; 
    const current = shop.slots[time] || 0;
    const remaining = limitGroups - current;

    if (remaining <= 0) return alert("満席です。");
    if (shop.isPaused) return alert("停止中です。");
    
    // 1組の最大人数 (capacity) を取得
    const maxPeople = shop.capacity || 10;

    setPeopleCount(1);
    // mode: slot, remaining: 残り組数, maxPeople: 選択可能な最大人数
    setDraftBooking({ time, remaining, mode: "slot", maxPeople });
  };
  // ▲▲▲ 修正終わり ▲▲▲

  // ▼▼▼ 修正: 順番待ち参加ボタン ▼▼▼
  const handleJoinQueue = (shop: any) => {
    if (activeTickets.length >= 3) return alert("チケットは3枚までです。");
    if (activeTickets.some(t => t.shopId === shop.id)) return alert("既にこの店に並んでいます。");
    if (shop.isPaused) return alert("停止中です。");

    // 順番待ちでも「1組の最大人数」を適用
    const maxPeople = shop.capacity || 10;

    setPeopleCount(1);
    // remainingは順番待ちでは表示に使わないため適当な値、maxPeopleを渡す
    setDraftBooking({ time: "順番待ち", remaining: 999, mode: "queue", maxPeople });
  };
  // ▲▲▲ 修正終わり ▲▲▲

  // 予約・発券の確定処理
  const handleConfirmBooking = async () => {
    if (!selectedShop || !draftBooking) return;

    if (!confirm(`${selectedShop.name}\n${draftBooking.mode === "queue" ? "並びますか？" : "予約しますか？"}\n人数: ${peopleCount}名`)) return;

    try {
      const timestamp = Date.now();
      const shopRef = doc(db, "attractions", selectedShop.id);
      
      if (draftBooking.mode === "slot") {
        // 時間予約
        // 注意: ここで increment(1) に変更（「組数」で枠を管理するため）
        // もし「人数」で枠を減らしたい場合は increment(peopleCount) に戻してください
        // 今回の要件「枠ごとの定員(組)」に従い、1予約につき1枠消費とします。
        const reservationData = { userId, time: draftBooking.time, timestamp, status: "reserved", count: peopleCount };
        await updateDoc(shopRef, { 
            [`slots.${draftBooking.time}`]: increment(1), // 組数ベースで消費
            reservations: arrayUnion(reservationData)
        });
      } else {
        // 順番待ち
        const shopSnap = await getDoc(shopRef);
        const currentQueue = shopSnap.data()?.queue || [];
        
        let maxId = 0;
        currentQueue.forEach((q: any) => {
            const num = parseInt(q.ticketId || "0");
            if (num > maxId) maxId = num;
        });

        const nextIdNum = maxId + 1;
        const nextTicketId = String(nextIdNum).padStart(6, '0');

        const queueData = {
          userId,
          ticketId: nextTicketId,
          count: peopleCount,
          status: "waiting",
          createdAt: Timestamp.now()
        };

        await updateDoc(shopRef, {
          queue: arrayUnion(queueData)
        });

        alert(`発券しました！\n番号: ${nextTicketId}`);
      }
      
      setDraftBooking(null);
      setSelectedShop(null);

    } catch (e) { 
      console.error(e);
      alert("エラーが発生しました。もう一度お試しください。"); 
    }
  };

  // キャンセル処理
  const handleCancel = async (ticket: Ticket) => {
    if (!confirm("キャンセルしますか？")) return;
    try {
      const shopRef = doc(db, "attractions", ticket.shopId);
      const shopSnap = await getDoc(shopRef);
      if (!shopSnap.exists()) return;
      const shopData = shopSnap.data();

      if (ticket.isQueue) {
         const targetQ = shopData.queue?.find((q: any) => q.ticketId === ticket.ticketId);
         if (targetQ) {
           await updateDoc(shopRef, { queue: arrayRemove(targetQ) });
         }
      } else {
         const targetRes = shopData.reservations?.find((r: any) => r.userId === userId && r.time === ticket.time && r.timestamp === ticket.timestamp);
         if (targetRes) {
           // 組数ベースで枠を戻すため increment(-1)
           await updateDoc(shopRef, { 
             [`slots.${ticket.time}`]: increment(-1),
             reservations: arrayRemove(targetRes)
           });
         }
      }
      alert("キャンセルしました");
    } catch (e) { alert("キャンセル失敗"); }
  };

  // 入場処理
  const handleEnter = async (ticket: Ticket) => {
    const shop = attractions.find(s => s.id === ticket.shopId);
    if (!shop) return;

    if (ticket.isQueue && ticket.status !== 'ready') {
      return alert("まだ呼び出しされていません。");
    }

    const inputPass = prompt(`${shop.name}のスタッフパスワードを入力：`);
    if (inputPass !== shop.password) return alert("パスワードが違います！");

    try {
      const shopRef = doc(db, "attractions", shop.id);

      if (ticket.isQueue) {
        const targetQ = shop.queue.find((q: any) => q.ticketId === ticket.ticketId);
        if(targetQ) {
          await updateDoc(shopRef, { queue: arrayRemove(targetQ) });
        }
      } else {
        const oldRes = shop.reservations.find((r: any) => r.userId === userId && r.time === ticket.time && r.status === "reserved");
        if(oldRes) {
            await updateDoc(shopRef, { reservations: arrayRemove(oldRes) });
            await updateDoc(shopRef, { reservations: arrayUnion({ ...oldRes, status: "used" }) });
        }
      }
      alert("入場処理が完了しました！");
    } catch(e) {
      alert("エラーが発生しました。");
      console.error(e);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 bg-gray-50 min-h-screen pb-20 relative">
      <header className="mb-6">
        <div className="flex justify-between items-center mb-2">
           <h1 className="text-xl font-bold text-blue-900">予約・整理券</h1>
           <div className={`px-3 py-1 rounded-full text-sm font-bold ${activeTickets.length >= 3 ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>
               {activeTickets.length}/3枚
           </div>
        </div>
        <div className="bg-gray-800 text-white text-center py-1 rounded text-xs font-mono">
           User ID: {userId}
        </div>
      </header>

      {/* チケット一覧 */}
      {activeTickets.length > 0 && (
        <div className="mb-8 space-y-4">
          <p className="text-blue-900 text-sm font-bold">🎟️ あなたのチケット</p>
          {activeTickets.map((t) => {
            const isReady = t.status === 'ready';
            const cardClass = isReady 
              ? "bg-red-50 border-l-4 border-red-500 shadow-xl ring-2 ring-red-400 animate-pulse-slow" 
              : "bg-white border-l-4 border-green-500 shadow-lg";

            return (
              <div key={t.uniqueKey} className={`${cardClass} p-4 rounded relative`}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                      <h2 className="font-bold text-lg flex items-center gap-2">
                          {t.shopName}
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full border border-green-200">
                             {t.count}名
                          </span>
                      </h2>
                      
                      {t.isQueue ? (
                        <div className="mt-2 p-2 bg-gray-100 rounded border border-gray-200 inline-block">
                          <p className="text-xs text-gray-500 font-bold mb-1">整理券番号</p>
                          <p className="text-3xl font-mono font-black text-gray-800 tracking-widest leading-none">
                              {t.ticketId}
                          </p>
                        </div>
                      ) : (
                        <p className="text-3xl font-bold text-blue-600 font-mono mt-1">{t.time}</p>
                      )}
                      
                      {t.isQueue && (
                          <div className="mt-2">
                              {isReady ? (
                                <p className="text-red-600 font-bold text-lg animate-bounce">🔔 呼び出し中です！</p>
                              ) : (
                                <p className="text-blue-600 font-bold text-sm">
                                  {/* ▼▼▼ 修正: 単位を「組待ち」に変更 ▼▼▼ */}
                                  あなたの前に <span className="text-xl text-blue-800">{t.peopleAhead}</span> 組待ち
                                </p>
                              )}
                          </div>
                      )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={() => handleEnter(t)} 
                    disabled={t.isQueue && !isReady} 
                    className={`flex-1 font-bold py-3 rounded-lg shadow transition
                      ${(t.isQueue && !isReady) 
                        ? "bg-gray-300 text-gray-500 cursor-not-allowed" 
                        : "bg-blue-600 text-white hover:bg-blue-500"
                      }`}
                  >
                    {t.isQueue && !isReady ? "待機中..." : "入場する"}
                  </button>
                  <button onClick={() => handleCancel(t)} className="px-4 text-red-500 border border-red-200 rounded-lg text-xs hover:bg-red-50">
                    キャンセル
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 店舗選択リスト */}
      {!selectedShop ? (
        <div className="space-y-3">
          <p className="text-sm font-bold text-gray-600 mb-2 border-b pb-2">アトラクションを選ぶ</p>
          {attractions.map((shop) => (
            <button key={shop.id} onClick={() => setSelectedShop(shop)} className={`w-full bg-white p-3 rounded-xl shadow-sm border text-left flex items-start gap-3 hover:bg-gray-50 transition ${shop.isPaused ? 'opacity-60 grayscale' : ''}`}>
              {shop.imageUrl && (
                  <div className="w-20 h-20 bg-gray-200 rounded-lg overflow-hidden flex-shrink-0">
                      <img src={shop.imageUrl} alt="" className="w-full h-full object-cover" />
                  </div>
              )}
              <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1 mb-1">
                      {shop.isQueueMode && <span className="bg-orange-100 text-orange-700 border-orange-200 border text-[10px] px-2 py-0.5 rounded font-bold">順番待ち制</span>}
                      {shop.isPaused && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded">受付停止中</span>}
                  </div>
                  <h3 className="font-bold text-lg leading-tight truncate text-gray-800 mb-1">{shop.name}</h3>
                  <div className="text-xs text-gray-400">
                      {/* 一覧表示の待ち組数: ここも人数合計ではなくlengthで組数を表示 */}
                      {shop.isQueueMode 
                        ? `待ち: ${shop.queue?.filter((q:any)=>q.status==='waiting').length || 0}組` 
                        : `予約可`}
                  </div>
              </div>
              <div className="self-center text-gray-300">&gt;</div>
            </button>
          ))}
        </div>
      ) : (
        // 詳細・予約画面
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden pb-10">
            <div className="relative">
               <button onClick={() => { setSelectedShop(null); setDraftBooking(null); }} className="absolute top-2 left-2 bg-black/60 text-white px-3 py-1 rounded-full text-sm backdrop-blur-sm z-10">← 戻る</button>
               <div className="p-4 pt-12 border-b bg-gray-50">
                   <h2 className="text-2xl font-bold">{selectedShop.name}</h2>
               </div>
            </div>

            <div className="p-4">
                {selectedShop.description && (
                    <div className="mb-6 text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded-lg border border-gray-100">
                        {selectedShop.description}
                    </div>
                )}

                {selectedShop.isPaused ? (
                    <p className="text-red-500 font-bold mb-4 bg-red-100 p-3 rounded text-center">現在 受付停止中です</p>
                ) : (
                    <>
                        {selectedShop.isQueueMode ? (
                           <div className="text-center py-6">
                              <div className="mb-6">
                                <p className="text-gray-500 text-sm font-bold mb-2">現在の待ち状況</p>
                                <div className="flex justify-center gap-4">
                                   <div className="bg-orange-50 p-3 rounded-lg border border-orange-100 min-w-[100px]">
                                      <p className="text-xs text-orange-600">待ち組数</p>
                                      <p className="text-3xl font-bold text-orange-900">
                                        {/* 待ち組数を表示 (length) */}
                                        {selectedShop.queue?.filter((q:any)=>q.status==='waiting').length || 0}
                                        <span className="text-sm font-normal ml-1">組</span>
                                      </p>
                                   </div>
                                </div>
                              </div>
                              <button 
                                onClick={() => handleJoinQueue(selectedShop)}
                                className="w-full bg-orange-500 text-white text-xl font-bold py-4 rounded-xl shadow-lg hover:bg-orange-600 transition flex items-center justify-center gap-2"
                              >
                                <span>🏃</span> 整理券を発券する
                              </button>
                           </div>
                        ) : (
                           <div className="grid grid-cols-3 gap-3">
                              {Object.entries(selectedShop.slots || {}).sort().map(([time, count]: any) => {
                                 // ▼▼▼ 修正: ここも定員(組)と最大人数(人)を区別 ▼▼▼
                                 const limitGroups = selectedShop.groupLimit || 0; // 枠の定員
                                 // capacity (1組あたりの人数) はここでは枠計算に使わない
                                 
                                 const isFull = count >= limitGroups;
                                 const remaining = limitGroups - count;
                                 const isBooked = activeTickets.some(t => t.shopId === selectedShop.id && t.time === time);
                                 // ▲▲▲ 修正終わり ▲▲▲
                                 
                                 return (
                                     <button 
                                       key={time} 
                                       disabled={isFull || isBooked} 
                                       onClick={() => handleSelectTime(selectedShop, time)}
                                       className={`p-2 rounded border h-24 flex flex-col items-center justify-center ${isBooked ? "bg-green-50 border-green-500" : "bg-white border-blue-200"}`}
                                     >
                                        <span className="font-bold">{time}</span>
                                        <span className="text-xs">{isBooked ? "予約済" : isFull ? "満席" : `あと${remaining}組`}</span>
                                     </button>
                                 );
                              })}
                           </div>
                        )}
                    </>
                )}
            </div>
        </div>
      )}
      
      {/* 申し込み確認モーダル */}
      {draftBooking && selectedShop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-sm rounded-xl shadow-2xl overflow-hidden">
            <div className={`${draftBooking.mode === "queue" ? "bg-orange-500" : "bg-blue-600"} text-white p-4 text-center`}>
              <h3 className="text-lg font-bold">{draftBooking.mode === "queue" ? "整理券の発券" : "予約の確認"}</h3>
            </div>
            
            <div className="p-6">
              <p className="text-center font-bold mb-4">{selectedShop.name}</p>
              
              <label className="block text-sm font-bold text-gray-700 mb-2">
                  人数を選択してください
              </label>
              <select 
                  value={peopleCount} 
                  onChange={(e) => setPeopleCount(Number(e.target.value))}
                  className="w-full text-lg p-3 border-2 border-gray-200 rounded-lg mb-6"
              >
                  {/* ▼▼▼ 修正: 選択肢を 1組の最大人数 (maxPeople) に基づいて生成 ▼▼▼ */}
                  {[...Array(draftBooking.maxPeople)].map((_, i) => (
                      <option key={i+1} value={i+1}>{i+1}名</option>
                  ))}
                  {/* ▲▲▲ 修正終わり ▲▲▲ */}
              </select>

              <div className="flex gap-3">
                  <button onClick={() => setDraftBooking(null)} className="flex-1 py-3 bg-gray-100 rounded-lg font-bold text-gray-500">やめる</button>
                  <button onClick={handleConfirmBooking} className={`flex-1 py-3 text-white font-bold rounded-lg shadow ${draftBooking.mode === "queue" ? "bg-orange-500" : "bg-blue-600"}`}>
                      {draftBooking.mode === "queue" ? "発券する" : "予約する"}
                  </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
