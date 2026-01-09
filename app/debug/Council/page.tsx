// ＃生徒会用管理画面 (app/admin/super/page.tsx)
"use client";
import { useState, useEffect, useMemo } from "react";
// 階層に合わせてパスを調整
import { db, auth } from "../../../firebase"; 
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

export default function SuperAdminPage() {
  const [attractions, setAttractions] = useState<any[]>([]);
  const [myUserId, setMyUserId] = useState("");

  // 表示モード管理
  const [expandedShopId, setExpandedShopId] = useState<string | null>(null); 
  const [isEditing, setIsEditing] = useState(false);
  const [originalId, setOriginalId] = useState<string | null>(null);

  // フォーム用ステート
  const [manualId, setManualId] = useState("");
  const [newName, setNewName] = useState("");
  const [password, setPassword] = useState("");
  
  // ★追加・変更フィールド
  const [department, setDepartment] = useState(""); // 団体名
  const [imageUrl, setImageUrl] = useState("");     // 画像URL
  const [description, setDescription] = useState(""); // ★会場説明文

  const [groupLimit, setGroupLimit] = useState(4);
  const [openTime, setOpenTime] = useState("10:00");
  const [closeTime, setCloseTime] = useState("15:00");
  const [duration, setDuration] = useState(20);
  const [capacity, setCapacity] = useState(3);
  const [isPaused, setIsPaused] = useState(false);

  // 検索用
  const [searchUserId, setSearchUserId] = useState("");

  useEffect(() => {
    signInAnonymously(auth).catch((e) => console.error(e));

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

    const unsub = onSnapshot(collection(db, "attractions"), (snapshot) => {
      setAttractions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // 統計データ
  const stats = useMemo(() => {
      const totalVenues = attractions.length;
      const pausedVenues = attractions.filter(a => a.isPaused).length;
      const totalReservations = attractions.reduce((sum, shop) => sum + (shop.reservations?.length || 0), 0);

      return {
          totalVenues: String(totalVenues).padStart(3, '0'),
          pausedVenues: String(pausedVenues).padStart(3, '0'),
          totalReservations: String(totalReservations).padStart(7, '0'),
      };
  }, [attractions]);

  // 一斉操作
  const handleBulkPause = async (shouldPause: boolean) => {
      const actionName = shouldPause ? "一斉停止" : "一斉再開";
      if(!confirm(`全ての会場を「${actionName}」しますか？`)) return;
      try {
          const promises = attractions.map(shop => 
              updateDoc(doc(db, "attractions", shop.id), { isPaused: shouldPause })
          );
          await Promise.all(promises);
          alert(`${actionName}が完了しました。`);
      } catch(e) { console.error(e); alert("エラーが発生しました。"); }
  };

  const handleBulkDeleteReservations = async () => {
      if(!confirm("【危険】全会場の「予約データ」を全て削除し、予約枠をリセットします。\n本当によろしいですか？")) return;
      if(prompt("確認のため 'DELETE' と入力してください") !== "DELETE") return;
      try {
          const promises = attractions.map(shop => {
              const resetSlots: any = {};
              Object.keys(shop.slots || {}).forEach(key => { resetSlots[key] = 0; });
              return updateDoc(doc(db, "attractions", shop.id), { reservations: [], slots: resetSlots });
          });
          await Promise.all(promises);
          alert("完了しました。");
      } catch(e) { console.error(e); alert("エラーが発生しました。"); }
  };

  const handleBulkDeleteVenues = async () => {
      if(!confirm("【超危険】全ての「会場データ」そのものを削除します。\n復元できません。本当によろしいですか？")) return;
      if(prompt("本気で削除する場合は 'DESTROY' と入力してください") !== "DESTROY") return;
      try {
          const promises = attractions.map(shop => deleteDoc(doc(db, "attractions", shop.id)));
          await Promise.all(promises);
          setExpandedShopId(null);
          alert("完了しました。");
      } catch(e) { console.error(e); alert("エラーが発生しました。"); }
  };

  // 編集・作成関連
  const resetForm = () => {
    setIsEditing(false);
    setOriginalId(null);
    setManualId(""); setNewName(""); setPassword("");
    setDepartment(""); setImageUrl(""); setDescription(""); // ★リセット
    setGroupLimit(4); setOpenTime("10:00"); setCloseTime("15:00");
    setDuration(20); setCapacity(3); setIsPaused(false);
  };

  const startEdit = (shop: any) => {
    setIsEditing(true);
    setOriginalId(shop.id);
    setManualId(shop.id); setNewName(shop.name); setPassword(shop.password);
    setDepartment(shop.department || "");
    setImageUrl(shop.imageUrl || "");
    setDescription(shop.description || ""); // ★読み込み
    setGroupLimit(shop.groupLimit || 4); setOpenTime(shop.openTime);
    setCloseTime(shop.closeTime); setDuration(shop.duration);
    setCapacity(shop.capacity); setIsPaused(shop.isPaused || false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSave = async () => {
    if (!manualId || !newName || !password) return alert("必須項目(ID, 会場名, Pass)を入力してください");
    if (password.length !== 5) return alert("パスワードは5桁です");

    if (isEditing && originalId !== manualId) {
        if (attractions.some(s => s.id === manualId)) return alert(`ID「${manualId}」は既に存在します。`);
    }

    let slots: any = {};
    let shouldResetSlots = true;
    let existingReservations = [];

    if (isEditing) {
        const currentShop = attractions.find(s => s.id === originalId);
        if (currentShop) {
            existingReservations = currentShop.reservations || [];
            if (currentShop.openTime === openTime && currentShop.closeTime === closeTime && currentShop.duration === duration) {
                slots = currentShop.slots;
                shouldResetSlots = false;
            } else {
                if(!confirm("時間を変更すると、現在の予約枠がリセットされます。よろしいですか？")) return;
            }
        }
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

    const data: any = {
      name: newName, password, groupLimit,
      department, imageUrl, description, // ★保存データに追加
      openTime, closeTime, duration, capacity, isPaused, slots,
      reservations: existingReservations
    };

    if (!isEditing) data.reservations = [];

    try {
        if (isEditing && originalId && manualId !== originalId) {
            if(!confirm(`会場IDを「${originalId}」から「${manualId}」に変更しますか？`)) return;
            await setDoc(doc(db, "attractions", manualId), data);
            await deleteDoc(doc(db, "attractions", originalId));
            setExpandedShopId(manualId);
        } else {
            await setDoc(doc(db, "attractions", manualId), data, { merge: true });
            if(isEditing) setExpandedShopId(manualId);
        }
        alert(isEditing ? "更新しました" : "作成しました");
        resetForm();
    } catch(e) { console.error(e); alert("エラーが発生しました"); }
  };

  const handleDeleteVenue = async (id: string) => {
    if (!confirm("本当に会場を削除しますか？")) return;
    await deleteDoc(doc(db, "attractions", id));
    setExpandedShopId(null);
  };

  // 予約操作
  const toggleReservationStatus = async (shop: any, res: any, newStatus: "reserved" | "used") => {
     if(!confirm(newStatus === "used" ? "入場済みにしますか？" : "入場を取り消しますか？")) return;
     const otherRes = shop.reservations.filter((r: any) => r.timestamp !== res.timestamp);
     const updatedRes = { ...res, status: newStatus };
     await updateDoc(doc(db, "attractions", shop.id), { reservations: [...otherRes, updatedRes] });
  };

  const cancelReservation = async (shop: any, res: any) => {
      if(!confirm(`User ID: ${res.userId}\nこの予約を削除しますか？`)) return;
      const otherRes = shop.reservations.filter((r: any) => r.timestamp !== res.timestamp);
      const updatedSlots = { ...shop.slots, [res.time]: Math.max(0, shop.slots[res.time] - 1) };
      await updateDoc(doc(db, "attractions", shop.id), { reservations: otherRes, slots: updatedSlots });
  };

  // 表示ヘルパー
  const targetShop = attractions.find(s => s.id === expandedShopId);
  const getReservationsByTime = (shop: any) => {
      const grouped: any = {};
      Object.keys(shop.slots || {}).sort().forEach(time => { grouped[time] = []; });
      shop.reservations?.forEach((res: any) => { if(grouped[res.time]) grouped[res.time].push(res); });
      return grouped;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans">
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex justify-between items-center sticky top-0 z-50 shadow-md">
          <div className="text-xs text-gray-400">Logged in as:</div>
          <div className="font-mono font-bold text-yellow-400 text-lg tracking-wider">{myUserId || "---"}</div>
      </div>

      <div className="max-w-4xl mx-auto p-4 pb-32">
        <div className="mb-6 border-b border-gray-700 pb-4">
          <h1 className="text-2xl font-bold text-red-500 mb-4">生徒会・実行委員用 (Full Access)</h1>
          
          <details className="bg-gray-800 rounded-lg p-4 border border-gray-700 mb-4" open={isEditing}>
              <summary className="cursor-pointer font-bold text-blue-400">➕ 新規会場の作成 / 設定フォーム</summary>
              <div className="mt-4 pt-4 border-t border-gray-700">
                  <h3 className="text-sm font-bold mb-2 text-gray-300">{isEditing ? `✏️ ${originalId} を編集中` : "新規作成"}</h3>
                  
                  <div className="grid gap-2 md:grid-cols-3 mb-2">
                      <input className={`p-2 rounded text-white bg-gray-700 ${isEditing && manualId !== originalId ? 'ring-2 ring-yellow-500' : ''}`}
                          placeholder="ID (例: 3B)" maxLength={3} value={manualId} onChange={e => setManualId(e.target.value)} />
                      <input className="bg-gray-700 p-2 rounded text-white" placeholder="会場名" value={newName} onChange={e => setNewName(e.target.value)} />
                      <input className="bg-gray-700 p-2 rounded text-white" placeholder="パスワード(5桁)" maxLength={5} value={password} onChange={e => setPassword(e.target.value)} />
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 mb-2">
                      <input className="bg-gray-700 p-2 rounded text-white" placeholder="団体名/クラス名 (例: 3年B組)" value={department} onChange={e => setDepartment(e.target.value)} />
                      <input className="bg-gray-700 p-2 rounded text-white" placeholder="画像URL (任意: Discord等のリンク)" value={imageUrl} onChange={e => setImageUrl(convertGoogleDriveLink(e.target.value))} />
                  </div>

                  {/* ★ 会場説明文入力エリア (新規追加) */}
                  <div className="mb-2">
                      <label className="text-xs text-gray-500 mb-1 block">会場説明文 (任意: 最大500文字)</label>
                      <textarea 
                          className="w-full bg-gray-700 p-2 rounded text-white h-24 text-sm border border-gray-600 focus:border-blue-500 outline-none"
                          placeholder="会場のアピールポイントや注意事項を入力してください。"
                          maxLength={500}
                          value={description}
                          onChange={e => setDescription(e.target.value)}
                      />
                      <div className="text-right text-xs text-gray-500">{description.length}/500</div>
                  </div>

                  {isEditing && manualId !== originalId && <div className="text-xs text-yellow-400 font-bold mb-2">⚠️ IDが変更されています。</div>}

                  <div className="grid grid-cols-4 gap-2 mb-2">
                      <input type="time" value={openTime} onChange={e => setOpenTime(e.target.value)} className="bg-gray-700 p-1 rounded text-sm"/>
                      <input type="time" value={closeTime} onChange={e => setCloseTime(e.target.value)} className="bg-gray-700 p-1 rounded text-sm"/>
                      <input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} className="bg-gray-700 p-1 rounded text-sm" placeholder="分"/>
                      <input type="number" value={capacity} onChange={e => setCapacity(Number(e.target.value))} className="bg-gray-700 p-1 rounded text-sm" placeholder="定員"/>
                  </div>
                  <div className="flex items-center gap-3 mb-3">
                      <label className="text-xs text-gray-400">1組人数:</label>
                      <input type="number" value={groupLimit} onChange={e => setGroupLimit(Number(e.target.value))} className="w-16 bg-gray-700 p-1 rounded text-sm" />
                      <label className="text-xs text-gray-400 flex items-center gap-1">
                          <input type="checkbox" checked={isPaused} onChange={e => setIsPaused(e.target.checked)} /> 受付停止
                      </label>
                  </div>
                  <div className="flex gap-2">
                      <button onClick={handleSave} className="flex-1 bg-blue-600 hover:bg-blue-500 py-2 rounded font-bold">{isEditing ? "変更を保存" : "会場を作成"}</button>
                      {isEditing && <button onClick={resetForm} className="bg-gray-600 px-4 rounded">キャンセル</button>}
                  </div>
              </div>
          </details>

          <div className="flex gap-2 items-center bg-gray-800 p-2 rounded border border-gray-600 mb-6">
              <span className="text-xl">🔍</span>
              <input className="flex-1 bg-transparent text-white outline-none" placeholder="ユーザーID検索..." value={searchUserId} onChange={e => setSearchUserId(e.target.value)} />
          </div>

          {/* ダッシュボード (省略なし) */}
          <div className="bg-black border border-gray-600 rounded-xl p-4 mb-6 shadow-xl">
              <h2 className="text-sm font-bold text-gray-400 mb-3 uppercase tracking-wider">Dashboard & Global Actions</h2>
              <div className="flex justify-between items-center mb-6 bg-gray-900 p-4 rounded-lg border border-gray-800">
                  <div className="text-center"><div className="text-xs text-gray-500 mb-1">TOTAL VENUES</div><div className="text-3xl font-mono font-bold text-white tracking-widest">{stats.totalVenues}</div></div>
                  <div className="text-center border-l border-r border-gray-700 px-6"><div className="text-xs text-gray-500 mb-1">PAUSED SHOPS</div><div className="text-3xl font-mono font-bold text-red-500 tracking-widest">{stats.pausedVenues}</div></div>
                  <div className="text-center"><div className="text-xs text-gray-500 mb-1">TOTAL RSV.</div><div className="text-3xl font-mono font-bold text-green-500 tracking-widest">{stats.totalReservations}</div></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <button onClick={() => handleBulkPause(true)} className="bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-800 py-2 rounded text-xs font-bold transition">🛑 一斉停止</button>
                  <button onClick={() => handleBulkPause(false)} className="bg-green-900/50 hover:bg-green-800 text-green-200 border border-green-800 py-2 rounded text-xs font-bold transition">▶️ 一斉再開</button>
                  <button onClick={handleBulkDeleteReservations} className="bg-orange-900/50 hover:bg-orange-800 text-orange-200 border border-orange-800 py-2 rounded text-xs font-bold transition">🗑️ 全予約削除</button>
                  <button onClick={handleBulkDeleteVenues} className="bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700 py-2 rounded text-xs font-bold transition">💀 会場全削除</button>
              </div>
          </div>
        </div>

        {!expandedShopId && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {attractions.map(shop => {
                    const hasUser = searchUserId && shop.reservations?.some((r:any) => r.userId?.includes(searchUserId.toUpperCase()));
                    const totalShopRes = shop.reservations?.length || 0;
                    return (
                        <button key={shop.id} onClick={() => setExpandedShopId(shop.id)} className={`p-4 rounded-xl border text-left flex justify-between items-center hover:bg-gray-800 transition ${hasUser ? 'bg-pink-900/40 border-pink-500' : 'bg-gray-800 border-gray-600'}`}>
                            <div className="flex items-center gap-4">
                                {/* 画像（任意表示・なければプレースホルダー） */}
                                {shop.imageUrl ? (
                                    <img src={shop.imageUrl} alt={shop.name} referrerPolicy="no-referrer" className="w-14 h-14 object-cover rounded-md bg-gray-900 shrink-0" />
                                ) : (
                                    <div className="w-14 h-14 bg-gray-700 rounded-md flex items-center justify-center text-xs text-gray-500 shrink-0">No Img</div>
                                )}
                                <div className="flex flex-col items-start min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-yellow-400 font-bold font-mono text-sm">{shop.id}</span>
                                        {shop.department && <span className="text-xs text-blue-300 font-bold border-l border-gray-600 pl-2">{shop.department}</span>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-lg leading-tight line-clamp-1">{shop.name}</span>
                                        {shop.isPaused && <span className="text-[10px] bg-red-600 px-1.5 py-0.5 rounded text-white whitespace-nowrap">停止中</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 pl-2">
                                <div className="text-right">
                                    <span className="text-[10px] text-gray-500 block">TOTAL</span>
                                    <span className="font-mono text-xl text-blue-400">{String(totalShopRes).padStart(4, '0')}</span>
                                </div>
                                <div className="text-gray-400 text-2xl">›</div>
                            </div>
                        </button>
                    );
                })}
            </div>
        )}

        {expandedShopId && targetShop && (
            <div className="animate-fade-in">
                <button onClick={() => { setExpandedShopId(null); setIsEditing(false); }} className="mb-4 flex items-center gap-2 text-gray-400 hover:text-white">← 会場一覧に戻る</button>
                <div className="bg-gray-800 rounded-xl border border-gray-600 overflow-hidden">
                    <div className="bg-gray-700 p-4 flex justify-between items-center relative overflow-hidden">
                        {targetShop.imageUrl && (
                            <div className="absolute inset-0 opacity-30">
                                <img src={targetShop.imageUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-gradient-to-r from-gray-900 via-gray-900/80 to-transparent"></div>
                            </div>
                        )}
                        <div className="relative z-10 flex-1">
                            {targetShop.department && <span className="text-[10px] font-bold bg-blue-500 text-white px-2 py-0.5 rounded mb-1 inline-block border border-blue-400">{targetShop.department}</span>}
                            <h2 className="text-2xl font-bold flex items-center gap-2"><span className="text-yellow-400 font-mono">{targetShop.id}</span>{targetShop.name}</h2>
                            <p className="text-xs text-gray-400 mt-1">Pass: {targetShop.password} | 定員: {targetShop.capacity}組</p>
                        </div>
                        <div className="flex gap-2 relative z-10">
                            <button onClick={() => startEdit(targetShop)} className="bg-blue-600 text-xs px-3 py-2 rounded hover:bg-blue-500 shadow">設定編集</button>
                            <button onClick={() => handleDeleteVenue(targetShop.id)} className="bg-red-600 text-xs px-3 py-2 rounded hover:bg-red-500 shadow">会場削除</button>
                        </div>
                    </div>

                    <div className="p-4 space-y-6">
                        {/* ★ 会場説明文の表示 (ここに追加) */}
                        {targetShop.description && (
                            <div className="bg-gray-700/50 p-4 rounded-lg border border-gray-600 text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                                {targetShop.description}
                            </div>
                        )}

                        {Object.entries(getReservationsByTime(targetShop)).map(([time, reservations]: any) => {
                            const slotCount = targetShop.slots[time] || 0;
                            const isFull = slotCount >= targetShop.capacity;
                            return (
                                <div key={time} className={`border rounded-lg p-3 ${isFull ? 'border-red-500/50 bg-red-900/10' : 'border-gray-600 bg-gray-900/50'}`}>
                                    <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-2">
                                        <h3 className="font-bold text-lg text-blue-300">{time}</h3>
                                        <span className={`text-sm font-bold ${isFull ? 'text-red-400' : 'text-green-400'}`}>予約: {slotCount} / {targetShop.capacity}</span>
                                    </div>
                                    <div className="space-y-2">
                                        {reservations.length === 0 && <p className="text-xs text-gray-500 text-center py-1">予約なし</p>}
                                        {reservations.map((res: any) => {
                                            const isMatch = searchUserId && res.userId?.includes(searchUserId.toUpperCase());
                                            return (
                                                <div key={res.timestamp} className={`flex justify-between items-center p-2 rounded ${res.status === 'used' ? 'bg-gray-800 opacity-60' : 'bg-gray-700'} ${isMatch ? 'ring-2 ring-pink-500' : ''}`}>
                                                    <div>
                                                        <div className="font-mono font-bold text-yellow-400">ID: {res.userId}</div>
                                                        <div className="text-xs text-gray-300">{res.status === 'used' ? '✅ 入場済' : '🔵 予約中'}</div>
                                                    </div>
                                                    <div className="flex gap-1">
                                                        {res.status !== 'used' ? (
                                                            <>
                                                                <button onClick={() => toggleReservationStatus(targetShop, res, "used")} className="bg-green-600 text-xs px-3 py-1.5 rounded font-bold hover:bg-green-500">入場</button>
                                                                <button onClick={() => cancelReservation(targetShop, res)} className="bg-red-600 text-xs px-3 py-1.5 rounded hover:bg-red-500">取消</button>
                                                            </>
                                                        ) : (
                                                            <button onClick={() => toggleReservationStatus(targetShop, res, "reserved")} className="bg-gray-500 text-xs px-2 py-1.5 rounded hover:bg-gray-400">入場取消</button>
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
                </div>
            </div>
        )}
      </div>
    </div>
  );
}
