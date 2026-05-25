// api/notify.js — 리마인더 알림 발송 (Vercel Cron)
const { GoogleAuth } = require('google-auth-library');

const FIREBASE_PROJECT = 'peakberry';
const DB_URL = 'https://peakberry-default-rtdb.firebaseio.com';

// 서비스 계정 키 (Vercel 환경변수에서 읽기)
function getServiceAccount() {
  return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
}

// Firebase Access Token 발급
async function getAccessToken() {
  const sa = getServiceAccount();
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

// Firebase DB에서 알림 설정 읽기
async function getNotifSettings() {
  const res = await fetch(`${DB_URL}/notifications/peakberry.json`);
  if (!res.ok) return null;
  return await res.json();
}

// FCM 알림 발송
async function sendFCM(token, title, body) {
  const accessToken = await getAccessToken();
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: token,
          notification: { title, body },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
              }
            }
          }
        }
      })
    }
  );
  const data = await res.json();
  return data;
}

// 요일/시간 체크
function shouldNotify(schedule) {
  const now = new Date();
  // KST = UTC+9
  const kstHour = (now.getUTCHours() + 9) % 24;
  const kstDay  = new Date(now.getTime() + 9 * 3600 * 1000).getUTCDay();
  const minute  = now.getUTCMinutes();

  if (!schedule.days || schedule.days.indexOf(kstDay) < 0) return false;
  if (schedule.hour !== kstHour) return false;
  if (minute > 2) return false; // Cron이 정시 ±2분 이내일 때만 발송
  return true;
}

export default async function handler(req, res) {
  // Vercel Cron 인증 확인
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const settings = await getNotifSettings();
    if (!settings || !settings.fcmToken) {
      return res.status(200).json({ message: 'No FCM token found' });
    }

    const token = settings.fcmToken;
    const sent = [];

    const reminders = [
      {
        id: 'seedling_remind',
        title: '육묘 기록',
        body: '오늘의 육묘 기록을 남겨주세요.',
      },
      {
        id: 'income_remind',
        title: '수입 기록',
        body: '오늘의 수입 내역을 기록해 주세요.',
      },
      {
        id: 'expense_remind',
        title: '지출 기록',
        body: '오늘의 지출 내역을 기록해 주세요.',
      },
    ];

    for (const reminder of reminders) {
      const cfg = settings[reminder.id];
      if (!cfg || !cfg.enabled) continue;
      if (!shouldNotify(cfg.schedule)) continue;

      await sendFCM(token, reminder.title, reminder.body);
      sent.push(reminder.id);
    }

    return res.status(200).json({ sent });
  } catch (e) {
    console.error('notify error:', e);
    return res.status(500).json({ error: e.message });
  }
}
