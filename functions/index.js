// functions/index.js – Firebase Functions v2
//
// ============================================================
//  DELIVERY FEE ENGINE:
//  calculateDeliveryFee -> Google Routes API
//  geocodeStoreAddress -> Google Geocoding API
// ============================================================

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { getMessaging } = require('firebase-admin/messaging');

const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

admin.initializeApp();
const db = getFirestore();

const YOCO_TEST_SECRET_KEY = defineSecret('YOCO_TEST_SECRET_KEY');
const YOCO_LIVE_SECRET_KEY = defineSecret('YOCO_LIVE_SECRET_KEY');
const YOCO_WEBHOOK_SIGNING_SECRET = defineSecret('YOCO_WEBHOOK_SIGNING_SECRET');
const GOOGLE_SERVER_KEY = defineSecret('GOOGLE_SERVER_KEY');

logger.info('✅ Secret references registered');

// ============================================================
//  HELPERS
// ============================================================

function getActivePriceServerSide(product, now = new Date()) {
  if (!product) return 0;
  const basePrice = Number(product.price) || 0;
  if (product.onSpecial !== true) return basePrice;
  const specialPrice = Number(product.specialPrice);
  if (!specialPrice || specialPrice <= 0) return basePrice;
  const endRaw = product.specialEndDate;
  const end = endRaw && typeof endRaw.toDate === 'function' ? endRaw.toDate()
            : endRaw ? new Date(endRaw) : null;
  if (end && !isNaN(end) && end < now) return basePrice;
  const startRaw = product.specialStartDate;
  const start = startRaw && typeof startRaw.toDate === 'function' ? startRaw.toDate()
              : startRaw ? new Date(startRaw) : null;
  if (start && !isNaN(start) && start > now) return basePrice;
  return specialPrice;
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifyYocoSignature({ rawBody, headers, secret }) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatureHeader = headers['webhook-signature'];

  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: 'Missing webhook signature headers' };
  }
  if (!secret || !secret.startsWith('whsec_')) {
    return { ok: false, reason: 'Missing or malformed webhook signing secret' };
  }

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'Invalid webhook-timestamp' };
  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - tsNum);
  if (skew > 180) return { ok: false, reason: `Timestamp outside replay window (${skew}s)` };

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const secretB64 = secret.slice('whsec_'.length);
  let secretKey;
  try {
    secretKey = Buffer.from(secretB64, 'base64');
  } catch (e) {
    return { ok: false, reason: 'Could not decode webhook secret' };
  }

  const expected = crypto
    .createHmac('sha256', secretKey)
    .update(signedContent, 'utf8')
    .digest('base64');

  const parts = String(signatureHeader).split(' ').filter(Boolean);
  let matched = false;
  for (const part of parts) {
    if (!part.startsWith('v1,')) continue;
    const sig = part.slice(3);
    if (timingSafeEqualStr(sig, expected)) { matched = true; break; }
  }

  if (!matched) return { ok: false, reason: 'Signature mismatch' };
  return { ok: true };
}

async function requireAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
  const doc = await db.collection('users').doc(request.auth.uid).get();
  if (!doc.exists || doc.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only');
  }
  return { uid: request.auth.uid, data: doc.data() };
}

function requireAuthPhone(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
  const phone = request.auth.token.phone_number;
  if (!phone) throw new HttpsError('failed-precondition', 'No phone number on auth token');
  return phone;
}

async function sendPushNotification(userId, title, body, data = {}) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      logger.warn(`sendPushNotification: User ${userId} not found`);
      return;
    }
    
    const userData = userDoc.data();
    // Only send if they have notifications enabled and have tokens
    if (userData.notificationsEnabled === false || !userData.fcmTokens || userData.fcmTokens.length === 0) {
      return;
    }

    const payload = {
      notification: { title, body },
      data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' }
    };

    const response = await getMessaging().sendEachForMulticast({
      tokens: userData.fcmTokens,
      ...payload
    });

    logger.info(`sendPushNotification: Sent to ${userId} (Success: ${response.successCount}, Failure: ${response.failureCount})`);
  } catch (error) {
    logger.error('sendPushNotification error:', error);
  }
}

// ============================================================
//  DELIVERY ENGINE — GOOGLE API HELPERS
// ============================================================

async function fetchRoutesDistance(storeLat, storeLng, customerLat, customerLng, apiKey) {
  try {
    const response = await axios.post(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        origin: { location: { latLng: { latitude: storeLat, longitude: storeLng } } },
        destination: { location: { latLng: { latitude: customerLat, longitude: customerLng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters'
        },
        timeout: 5000
      }
    );

    if (response.data?.routes?.[0]?.distanceMeters) {
      return response.data.routes[0].distanceMeters / 1000; // convert to km
    }
    throw new Error('No route found');
  } catch (error) {
    logger.error('Routes API error:', error.response?.data || error.message);
    throw new HttpsError('internal', 'Could not calculate distance. Please try again.');
  }
}

async function calculateFeeInternal(storeId, customerAddress, customerLat, customerLng) {
  const settingsRef = db.collection('settings').doc('deliveryPricing');
  const settingsSnap = await settingsRef.get();
  
  const baseFee = settingsSnap.exists ? (settingsSnap.data().baseFee ?? 18) : 18;
  const perKmRate = settingsSnap.exists ? (settingsSnap.data().perKmRate ?? 4) : 4;
  const minFee = settingsSnap.exists ? (settingsSnap.data().minFee ?? baseFee) : baseFee;
  const maxFee = settingsSnap.exists ? settingsSnap.data().maxFee : null;

  // Check manual overrides
  const overridesSnap = await db.collection('deliveryOverrides').where('enabled', '==', true).get();
  const cleanAddress = customerAddress.toLowerCase().trim();
  
  for (const doc of overridesSnap.docs) {
    const data = doc.data();
    if (cleanAddress.includes(data.address.toLowerCase().trim())) {
      return { fee: data.fee, isOverride: true, distanceKm: 0 };
    }
  }

  // Get store coords
  const storeSnap = await db.collection('stores').doc(storeId).get();
  if (!storeSnap.exists) throw new HttpsError('not-found', 'Store not found');
  const storeData = storeSnap.data();
  
  if (!storeData.lat || !storeData.lng) {
    throw new HttpsError('failed-precondition', 'This store does not have coordinates set. Cannot calculate delivery.');
  }

  if (!customerLat || !customerLng) {
    throw new HttpsError('invalid-argument', 'Customer coordinates missing.');
  }

  const apiKey = GOOGLE_SERVER_KEY.value();
  const distanceKm = await fetchRoutesDistance(storeData.lat, storeData.lng, customerLat, customerLng, apiKey);

  let calculatedFee = baseFee + (perKmRate * distanceKm);
  if (calculatedFee < minFee) calculatedFee = minFee;
  if (maxFee !== null && maxFee > 0 && calculatedFee > maxFee) calculatedFee = maxFee;

  // Round to 2 decimal places
  calculatedFee = Math.round(calculatedFee * 100) / 100;

  return { fee: calculatedFee, distanceKm: Math.round(distanceKm * 100) / 100, isOverride: false };
}

// ============================================================
//  CALLABLE: calculateDeliveryFee
// ============================================================
exports.calculateDeliveryFee = onCall(
  { secrets: [GOOGLE_SERVER_KEY] },
  async (request) => {
    const { storeId, customerAddress, customerLat, customerLng } = request.data;
    if (!storeId || !customerAddress) {
      throw new HttpsError('invalid-argument', 'Missing storeId or address');
    }
    try {
      return await calculateFeeInternal(storeId, customerAddress, customerLat, customerLng);
    } catch (err) {
      logger.error('calculateDeliveryFee error:', err);
      throw new HttpsError('internal', err.message || 'Fee calculation failed');
    }
  }
);

// ============================================================
//  CALLABLE: geocodeStoreAddress (Admin)
// ============================================================
exports.geocodeStoreAddress = onCall(
  { secrets: [GOOGLE_SERVER_KEY] },
  async (request) => {
    await requireAdmin(request);
    const { address } = request.data;
    if (!address) throw new HttpsError('invalid-argument', 'Missing address');

    try {
      const apiKey = GOOGLE_SERVER_KEY.value();
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
      const response = await axios.get(url);
      
      if (response.data.status === 'OK' && response.data.results[0]) {
        const location = response.data.results[0].geometry.location;
        return { success: true, lat: location.lat, lng: location.lng };
      }
      throw new Error(response.data.status || 'Geocode failed');
    } catch (err) {
      logger.error('Geocode error:', err.message);
      throw new HttpsError('internal', 'Could not find coordinates for this address. Please check the address.');
    }
  }
);

// ============================================================
//  1. onOrderCreated
// ============================================================
exports.onOrderCreated = onDocumentCreated('orders/{orderId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const orderId = snap.id;

  const freshSnap = await snap.ref.get();
  if (!freshSnap.exists) return;
  const order = freshSnap.data();

  const initUpdates = {};
  if (typeof order.storeAcceptToken !== 'string' || !order.storeAcceptToken) {
    const token = Buffer.from(`${orderId}:${Date.now()}`).toString('base64').slice(0, 16);
    initUpdates.storeAcceptToken = token;
    initUpdates.storeAcceptUrl =
      `https://ghostshopza.web.app/store-accept.html?orderId=${orderId}&token=${token}`;
  }
  if (typeof order.storeAccepted !== 'boolean') initUpdates.storeAccepted = false;
  if (typeof order.storeReady !== 'boolean') initUpdates.storeReady = false;
  if (typeof order.packed !== 'boolean') initUpdates.packed = false;
  if (!Array.isArray(order.refundedItemIndexes)) initUpdates.refundedItemIndexes = [];

  if (Object.keys(initUpdates).length > 0) {
    await snap.ref.update(initUpdates);
  }

  const acceptUrl = initUpdates.storeAcceptUrl || order.storeAcceptUrl;
  const storeName = order.store || 'Unknown Store';
  const total = order.total || 0;

  const notifRef = db.collection('storeNotifications').doc(orderId);
  try {
    const items = order.items
      ? order.items.map(i => `${i.name} × ${i.quantity}`).join('\n')
      : '';
    const message = `
*🛍️ New Order from ${storeName}*

Order #${orderId.slice(-6).toUpperCase()}
Total: R${total.toFixed(2)}

Items:
${items}

📦 Please confirm stock by clicking the link below:
${acceptUrl}

If you have any issues, please contact Ghost Shopper support.
    `.trim();

    const storeQuery = await db.collection('stores')
      .where('name', '==', order.store).limit(1).get();
    let primaryPhone = '';
    let secondaryPhone = '';
    if (!storeQuery.empty) {
      const storeData = storeQuery.docs[0].data();
      primaryPhone = storeData.whatsappPrimary || '';
      secondaryPhone = storeData.whatsappSecondary || '';
    }
    if (!primaryPhone) primaryPhone = '+27628989813';

    await notifRef.create({
      orderId,
      storeName: order.store || 'Unknown',
      primaryPhone,
      secondaryPhone,
      message,
      acceptUrl,
      sent: false,
      createdAt: FieldValue.serverTimestamp()
    });
    logger.info(`Order ${orderId}: store notification created`);
  } catch (err) {
    const code = err && err.code;
    if (code === 6 || code === 'already-exists') {
      logger.info(`Order ${orderId}: store notification already exists — skipping`);
    } else {
      logger.error('store notification create failed:', err);
    }
  }

  try {
    const customerName = order.customerName || order.customerPhone || 'Customer';
    await sendPushNotificationToAdmins(
      '🛍️ New order',
      `Order #${orderId.slice(-6).toUpperCase()} — R${total.toFixed(2)} from ${customerName} at ${storeName}`,
      { type: 'new_order', orderId }
    );
  } catch (err) {
    logger.error('Admin push for new order failed:', err);
  }
});

// ============================================================
//  2. storeAcceptOrder (unchanged logic)
// ============================================================
exports.storeAcceptOrder = onCall(async (request) => {
  const data = request.data || {};
  const { orderId, token, items, ready, packed } = data;

  if (typeof orderId !== 'string' || orderId.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing or invalid orderId');
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing or invalid token');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'items must be a non-empty array');
  }

  const orderRef = db.collection('orders').doc(orderId);
  const opRef = db.collection('orderAcceptOperations').doc(orderId);

  const result = await db.runTransaction(async (tx) => {
    const orderDoc = await tx.get(orderRef);
    if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found');
    const order = orderDoc.data();

    if (order.storeAcceptToken !== token) {
      throw new HttpsError('permission-denied', 'Invalid token');
    }
    if (!Array.isArray(order.items)) {
      throw new HttpsError('failed-precondition', 'Order has no items');
    }
    if (items.length !== order.items.length) {
      throw new HttpsError(
        'invalid-argument',
        `items length (${items.length}) does not match order items (${order.items.length})`
      );
    }

    const alreadyRefunded = Array.isArray(order.refundedItemIndexes) ? order.refundedItemIndexes : [];
    let userRef = null;
    let userSnap = null;
    if (order.customerId) {
      userRef = db.collection('users').doc(order.customerId);
      userSnap = await tx.get(userRef);
    }

    let itemRefundAmount = 0;
    const newlyRejected = [];
    const allRejected = [...alreadyRefunded];

    const updatedItems = order.items.map((item, idx) => {
      const itemData = items[idx] || {};
      const accepted = itemData.accepted === true;
      const alternateAccepted = itemData.alternateAccepted === true;
      const isOutOfStock = itemData.isOutOfStock === true;

      let finalAccepted = false;
      let finalAlternate = null;
      let finalAlternateAccepted = false;
      const wasAlreadyRefunded = alreadyRefunded.includes(idx);

      if (isOutOfStock) {
        if (!wasAlreadyRefunded) {
          itemRefundAmount += (item.price * item.quantity);
          newlyRejected.push(idx);
          allRejected.push(idx);
        }
      } else if (alternateAccepted && item.alternate) {
        finalAlternateAccepted = true;
        finalAlternate = item.alternate;
      } else if (accepted) {
        finalAccepted = true;
      } else {
        if (!wasAlreadyRefunded) {
          itemRefundAmount += (item.price * item.quantity);
          newlyRejected.push(idx);
          allRejected.push(idx);
        }
      }

      return {
        ...item,
        accepted: finalAccepted,
        alternateAccepted: finalAlternateAccepted,
        alternate: finalAlternate || item.alternate || null,
        isOutOfStock
      };
    });

    const totalItemCount = order.items.length;
    const allItemsRejected = allRejected.length >= totalItemCount;

    let refundAmount;
    let resultingStatus;

    if (allItemsRejected) {
      const previouslyRefunded = Number(order.refundAmount || 0);
      const fullTotal = Number(order.total || 0);
      const remaining = Math.max(0, Math.round((fullTotal - previouslyRefunded) * 100) / 100);
      refundAmount = remaining;
      resultingStatus = 'refunded';
    } else {
      refundAmount = Math.round(itemRefundAmount * 100) / 100;
      resultingStatus = null;
    }

    if (refundAmount > 0) {
      if (!order.customerId) {
        throw new HttpsError('failed-precondition', 'Order has no customerId but a refund is due. Aborting — no changes committed.');
      }
      if (!userSnap || !userSnap.exists) {
        throw new HttpsError('failed-precondition', `Customer document ${order.customerId} not found. Aborting.`);
      }
    }

    const updates = {
      items: updatedItems,
      storeAccepted: true,
      refundedItemIndexes: allRejected,
      updatedAt: FieldValue.serverTimestamp()
    };

    if (resultingStatus === 'refunded') {
      updates.orderStatus = 'refunded';
      updates.storeReady = false;
      updates.packed = false;
      updates.refundedAt = FieldValue.serverTimestamp();
    } else if (packed === true) {
      updates.packed = true;
      updates.orderStatus = 'packed';
    } else if (ready === true) {
      updates.storeReady = true;
      updates.orderStatus = 'ready';
    } else {
      updates.orderStatus = 'packing';
    }

    tx.update(orderRef, updates);

    if (refundAmount > 0) {
      const currentBalance = Number(userSnap.data().walletBalance || 0);
      const newBalance = Math.round((currentBalance + refundAmount) * 100) / 100;
      tx.update(userRef, {
        walletBalance: newBalance,
        updatedAt: FieldValue.serverTimestamp()
      });

      tx.update(orderRef, {
        refundAmount: Number(order.refundAmount || 0) + refundAmount,
        refundHistory: FieldValue.arrayUnion({
          amount: refundAmount,
          reason: resultingStatus === 'refunded' ? 'Full refund — all items unavailable' : 'Out-of-stock items at store acceptance',
          itemIndexes: newlyRejected,
          includesDelivery: resultingStatus === 'refunded',
          initiatedBy: 'store_accept',
          at: new Date().toISOString()
        }),
        refundProcessedAt: FieldValue.serverTimestamp()
      });
    }

    tx.set(opRef, {
      orderId, ready: !!ready, packed: !!packed, allItemsRejected,
      rejectedItemIndexes: allRejected, refundThisCall: refundAmount,
      resultingStatus: updates.orderStatus, processedAt: FieldValue.serverTimestamp()
    });

    return {
      status: updates.orderStatus, refundAmount, newRefundCount: newlyRejected.length,
      totalRejectedCount: allRejected.length, allItemsRejected,
      customerId: order.customerId, store: order.store
    };
  });

  if (result.refundAmount > 0) {
    try {
      await sendPushNotification(
        result.customerId,
        result.allItemsRejected ? '💰 Full Refund Processed' : '💰 Refund Processed',
        result.allItemsRejected
          ? `R${result.refundAmount.toFixed(2)} has been refunded to your wallet. All items were unavailable.`
          : `R${result.refundAmount.toFixed(2)} has been refunded to your wallet for unavailable items.`,
        { orderId, type: 'refund' }
      );
    } catch (err) { logger.error('storeAcceptOrder refund push failed:', err); }
  }

  if (result.status === 'ready') {
    try { await notifyDrivers(orderId, result.store); }
    catch (err) { logger.error('notifyDrivers failed:', err); }
  }

  if (result.customerId && result.status !== 'refunded') {
    const statusMsg = packed ? 'packed and ready for collection!' :
                      ready ? 'packed and is ready for pickup!' : 'accepted and is being packed.';
    try {
      await sendPushNotification(
        result.customerId, 'Order Update',
        `Your order #${orderId.slice(-6)} has been ${statusMsg}`,
        { orderId, status: result.status }
      );
    } catch (err) { logger.error('storeAcceptOrder status push failed:', err); }
  }

  return { success: true, status: result.status, refunded: result.refundAmount, fullRefund: result.allItemsRejected };
});

// ============================================================
//  3. notifyDrivers
// ============================================================
async function notifyDrivers(orderId, storeName) {
  const storeQuery = await db.collection('stores').where('name', '==', storeName).limit(1).get();
  if (storeQuery.empty) return;
  const storeData = storeQuery.docs[0].data();
  const area = storeData.area || 'Verulam';

  const driversSnap = await db.collection('drivers')
    .where('approved', '==', true)
    .where('isOnline', '==', true)
    .where('area', '==', area)
    .get();

  if (driversSnap.empty) return;

  const orderDoc = await db.collection('orders').doc(orderId).get();
  const order = orderDoc.data();
  const orderTotal = order.total || 0;

  await Promise.all(driversSnap.docs.map(doc =>
    sendPushNotificationToDriver(
      doc.id,
      '🚚 New Order Available',
      `Order #${orderId.slice(-6)} from ${storeName} – R${orderTotal.toFixed(2)}. Tap to accept.`,
      { orderId, storeName, type: 'new_order' }
    )
  ));
}

// ============================================================
//  4. issueCreditNote
// ============================================================
exports.issueCreditNote = onCall(async (request) => {
  const admin = await requireAdmin(request);
  const { userId, amount, reason, idempotencyKey } = request.data || {};

  if (!userId || !amount || amount <= 0) {
    throw new HttpsError('invalid-argument', 'Missing userId or invalid amount');
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
    throw new HttpsError('invalid-argument', 'Missing or invalid idempotencyKey');
  }

  const amt = Math.round(Number(amount) * 100) / 100;
  const opKey = `credit_note:${idempotencyKey}`;
  const opRef = db.collection('creditNoteOperations').doc(opKey);
  const userRef = db.collection('users').doc(userId);

  const result = await db.runTransaction(async (tx) => {
    const opSnap = await tx.get(opRef);
    if (opSnap.exists) {
      const prev = opSnap.data();
      return { alreadyProcessed: true, newBalance: prev.newBalance, amount: prev.amount };
    }
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found');
    const currentBalance = Number(userSnap.data().walletBalance || 0);
    const newBalance = Math.round((currentBalance + amt) * 100) / 100;

    tx.update(userRef, {
      walletBalance: newBalance,
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.set(opRef, {
      userId, amount: amt, reason: reason || 'Credit note from admin',
      previousBalance: currentBalance, newBalance, initiatedBy: admin.uid,
      createdAt: FieldValue.serverTimestamp()
    });
    tx.set(db.collection('creditNotes').doc(), {
      userId, amount: amt, reason: reason || 'Credit note from admin',
      issuedBy: admin.uid, issuedAt: FieldValue.serverTimestamp(),
      used: false, opKey
    });
    return { alreadyProcessed: false, newBalance, amount: amt };
  });

  if (!result.alreadyProcessed) {
    try {
      await sendPushNotification(
        userId, '💰 Credit Note Issued',
        `R${result.amount.toFixed(2)} has been added to your wallet.${reason ? ' Reason: ' + reason : ''}`,
        { type: 'credit_note' }
      );
    } catch (e) { logger.warn('issueCreditNote push failed', e); }
  }
  return { success: true, ...result };
});

// ============================================================
//  5. payDriver
// ============================================================
exports.payDriver = onCall(async (request) => {
  const admin = await requireAdmin(request);
  const { driverId, amount, requestId } = request.data;
  if (!driverId || !amount || amount <= 0) {
    throw new HttpsError('invalid-argument', 'Missing driverId or invalid amount');
  }
  try {
    const driverRef = db.collection('drivers').doc(driverId);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) throw new HttpsError('not-found', 'Driver not found');
    const driverData = driverSnap.data();
    const currentPaid = driverData.paidEarnings || 0;
    const totalEarnings = driverData.totalEarnings || 0;
    const newPaid = currentPaid + amount;
    if (!requestId && newPaid > totalEarnings) {
      throw new HttpsError('failed-precondition', 'Amount exceeds total earnings');
    }
    await driverRef.update({
      paidEarnings: newPaid,
      updatedAt: FieldValue.serverTimestamp(),
      lastPaidAt: FieldValue.serverTimestamp()
    });
    await db.collection('driverPayments').add({
      driverId, amount, paidBy: admin.uid,
      paidAt: FieldValue.serverTimestamp(),
      previousPaid: currentPaid, newPaid
    });
    await sendPushNotification(driverId, '💰 Payment Received',
      `You have been paid R${amount.toFixed(2)} for your deliveries.`,
      { type: 'driver_payment' });
    return { success: true, previousPaid: currentPaid, newPaid, unpaid: totalEarnings - newPaid };
  } catch (error) {
    logger.error('Driver payment error:', error);
    throw new HttpsError('internal', error.message || 'Failed to pay driver');
  }
});

// ============================================================
//  6. getDriverOrders
// ============================================================
exports.getDriverOrders = onCall(async (request) => {
  const phone = requireAuthPhone(request);
  const { date } = request.data || {};
  try {
    let query = db.collection('orders').where('driverId', '==', phone);
    if (date) {
      const startDate = new Date(date); startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date); endDate.setHours(23, 59, 59, 999);
      query = query.where('createdAt', '>=', startDate).where('createdAt', '<=', endDate);
    }
    const ordersSnap = await query.get();
    const orders = [];
    ordersSnap.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
    return { success: true, orders, count: orders.length };
  } catch (error) {
    logger.error('Get driver orders error:', error);
    throw new HttpsError('internal', error.message);
  }
});

// ============================================================
//  7. markRefundPaid
// ============================================================
exports.markRefundPaid = onCall(async (request) => {
  const admin = await requireAdmin(request);
  const { refundId } = request.data;
  if (!refundId) throw new HttpsError('invalid-argument', 'Missing refundId');

  const refundRef = db.collection('refundRequests').doc(refundId);

  const result = await db.runTransaction(async (tx) => {
    const refundSnap = await tx.get(refundRef);
    if (!refundSnap.exists) throw new HttpsError('not-found', 'Refund request not found');
    const refund = refundSnap.data();

    if (refund.status === 'completed') {
      return { alreadyProcessed: true, amount: refund.amount || 0, appliedDebit: refund.appliedDebit || 0 };
    }
    if (refund.status === 'rejected') {
      throw new HttpsError('failed-precondition', 'Refund request was rejected');
    }

    const amount = Math.round(Number(refund.amount || 0) * 100) / 100;
    if (amount <= 0) throw new HttpsError('failed-precondition', 'Refund amount is zero');
    if (!refund.userId) throw new HttpsError('failed-precondition', 'Refund request has no linked customer');

    const userRef = db.collection('users').doc(refund.userId);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new HttpsError('failed-precondition', 'Customer account not found');

    const currentBalance = Number(userSnap.data().walletBalance || 0);
    if (currentBalance < amount) {
      throw new HttpsError('failed-precondition', `Wallet balance (R${currentBalance.toFixed(2)}) is less than the refund amount (R${amount.toFixed(2)}). Cannot complete. Reduce the refund amount or reconcile the wallet first.`);
    }

    const newBalance = Math.round((currentBalance - amount) * 100) / 100;

    tx.update(userRef, { walletBalance: newBalance, updatedAt: FieldValue.serverTimestamp() });
    tx.update(refundRef, {
      status: 'completed', paidAt: FieldValue.serverTimestamp(),
      paidBy: admin.uid, appliedDebit: amount,
      previousBalance: currentBalance, newBalance
    });

    return { alreadyProcessed: false, amount, appliedDebit: amount, newBalance };
  });

  return { success: true, ...result };
});

// ============================================================
//  8. rejectRefund
// ============================================================
exports.rejectRefund = onCall(async (request) => {
  const admin = await requireAdmin(request);
  const { refundId } = request.data;
  if (!refundId) throw new HttpsError('invalid-argument', 'Missing refundId');

  const refundRef = db.collection('refundRequests').doc(refundId);

  return await db.runTransaction(async (tx) => {
    const refundSnap = await tx.get(refundRef);
    if (!refundSnap.exists) throw new HttpsError('not-found', 'Refund request not found');
    const refund = refundSnap.data();

    if (refund.status === 'completed') throw new HttpsError('failed-precondition', 'Refund has already been paid.');
    if (refund.status === 'rejected') return { success: true, alreadyProcessed: true };

    tx.update(refundRef, { status: 'rejected', rejectedAt: FieldValue.serverTimestamp(), rejectedBy: admin.uid });
    return { success: true, alreadyProcessed: false };
  });
});

// ============================================================
//  9. archiveOrders
// ============================================================
exports.archiveOrders = onCall(async (request) => {
  const admin = await requireAdmin(request);
  const { orderIds } = request.data;
  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Missing orderIds');
  }
  try {
    const batch = db.batch();
    for (const orderId of orderIds) {
      const orderRef = db.collection('orders').doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) continue;
      const orderData = orderSnap.data();
      const archiveRef = db.collection('archivedOrders').doc(orderId);
      batch.set(archiveRef, { ...orderData, archivedAt: FieldValue.serverTimestamp(), archivedBy: admin.uid });
      batch.delete(orderRef);
    }
    await batch.commit();
    return { success: true, count: orderIds.length };
  } catch (error) {
    logger.error('Archive orders error:', error);
    throw new HttpsError('internal', error.message || 'Failed to archive orders');
  }
});

// ============================================================
//  10. updateDriverArea
// ============================================================
exports.updateDriverArea = onCall(async (request) => {
  await requireAdmin(request);
  const { driverId, area } = request.data;
  if (!driverId || !area) throw new HttpsError('invalid-argument', 'Missing driverId or area');
  try {
    await db.collection('drivers').doc(driverId).update({ area, updatedAt: FieldValue.serverTimestamp() });
    return { success: true };
  } catch (error) {
    logger.error('Update driver area error:', error);
    throw new HttpsError('internal', error.message || 'Failed to update driver area');
  }
});

// ============================================================
//  11. sendPushNotification (admin callable)
// ============================================================
exports.sendPushNotification = onCall(async (request) => {
  await requireAdmin(request);
  const { userIds, title, body, data } = request.data;
  if (!title || !body) throw new HttpsError('invalid-argument', 'Missing title or body');
  try {
    let recipients = [];
    let tokens = [];
    if (userIds && userIds.length > 0) {
      for (const userId of userIds) {
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          if (userData.notificationsEnabled !== false && userData.fcmTokens) {
            tokens.push(...userData.fcmTokens);
            recipients.push(userId);
          }
        }
      }
    } else {
      const usersSnap = await db.collection('users').where('role', '==', 'customer').get();
      usersSnap.forEach(doc => {
        const user = doc.data();
        if (user.notificationsEnabled !== false && user.fcmTokens) {
          tokens.push(...user.fcmTokens);
          recipients.push(doc.id);
        }
      });
    }
    if (tokens.length === 0) return { success: false, message: 'No users with valid tokens' };
    const payload = { notification: { title, body }, data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' } };
    const response = await getMessaging().sendEachForMulticast({ tokens, ...payload });
    await db.collection('notifications').add({
      title, message: body, recipients, recipientCount: recipients.length,
      sentBy: request.auth.uid, sentAt: FieldValue.serverTimestamp(), data: data || {}
    });
    return { success: true, sent: response.successCount, recipients: recipients.length, tokens: tokens.length };
  } catch (error) {
    logger.error('Send push notification error:', error);
    throw new HttpsError('internal', error.message || 'Failed to send notification');
  }
});

// ============================================================
//  12. createYocoCheckout (Deprecated 410)
// ============================================================
exports.createYocoCheckout = onRequest(
  { cors: true, secrets: [YOCO_TEST_SECRET_KEY, YOCO_LIVE_SECRET_KEY] },
  async (req, res) => {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    res.status(410).json({ success: false, error: 'createYocoCheckout is deprecated. Use createCardOrder.' });
  }
);

// ============================================================
//  13. createCardOrder
// ============================================================
exports.createCardOrder = onCall(
  { secrets: [YOCO_TEST_SECRET_KEY, YOCO_LIVE_SECRET_KEY, GOOGLE_SERVER_KEY] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
    const uid = request.auth.uid;

    const { items, paymentMethod, deliveryAddress, timeSlotDisplay, customerPhone, idempotencyKey } = request.data || {};

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new HttpsError('invalid-argument', 'Missing or invalid idempotencyKey');
    }

    const idemRef = db.collection('idempotencyKeys').doc(idempotencyKey);

    let reservationOutcome;
    try {
      reservationOutcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(idemRef);
        if (snap.exists) {
          const d = snap.data();
          if (d.uid && d.uid !== uid) {
            throw new HttpsError('permission-denied', 'Idempotency key already used by another user');
          }
          if (d.status === 'completed') return { kind: 'completed', prior: d };
          if (d.status === 'in_progress') return { kind: 'in_progress', prior: d };
        }
        tx.set(idemRef, { uid, status: 'in_progress', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        return { kind: 'reserved' };
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', 'Idempotency reservation failed');
    }

    if (reservationOutcome.kind === 'completed') {
      const prior = reservationOutcome.prior;
      if (prior.failed) throw new HttpsError('failed-precondition', prior.failureReason || 'Previous attempt failed');
      return { success: true, orderId: prior.orderId || null, pendingOrderId: prior.pendingOrderId || null, redirectUrl: prior.redirectUrl, testMode: prior.testMode || false, idempotentReplay: true };
    }

    if (reservationOutcome.kind === 'in_progress') {
      return { success: true, inProgress: true, pendingOrderId: reservationOutcome.prior.pendingOrderId || null, message: 'A checkout with this key is already being processed.' };
    }

    const releaseIdemDefinite = async () => { try { await idemRef.delete(); } catch (_) {} };
    const preserveIdemAmbiguous = async (pendingOrderId, reasonMsg) => {
      try {
        await idemRef.set({ uid, status: 'in_progress', pendingOrderId: pendingOrderId || null, ambiguous: true, ambiguousReason: reasonMsg || 'network', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      } catch (_) {}
    };

    try {
      if (!Array.isArray(items) || items.length === 0) { await releaseIdemDefinite(); throw new HttpsError('invalid-argument', 'Cart is empty'); }
      if (!['yoco', 'wallet', 'split'].includes(paymentMethod)) { await releaseIdemDefinite(); throw new HttpsError('invalid-argument', 'Invalid payment method'); }
      if (!deliveryAddress || typeof deliveryAddress.street !== 'string') { await releaseIdemDefinite(); throw new HttpsError('invalid-argument', 'Missing delivery address'); }
      if (typeof timeSlotDisplay !== 'string' || !timeSlotDisplay.trim() || timeSlotDisplay.length > 200) { await releaseIdemDefinite(); throw new HttpsError('invalid-argument', 'Invalid delivery time slot'); }

      const userRef = db.collection('users').doc(uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) { await releaseIdemDefinite(); throw new HttpsError('failed-precondition', 'User profile not found'); }
      const userData = userSnap.data();
      const walletBalance = Number(userData.walletBalance || 0);

      let testMode = false;
      try {
        const tmSnap = await db.collection('settings').doc('testMode').get();
        if (tmSnap.exists) testMode = tmSnap.data().enabled === true;
      } catch (_) {}

      const productIds = items.map(i => i.productId || i.id).filter(Boolean);
      if (productIds.length === 0) { await releaseIdemDefinite(); throw new HttpsError('invalid-argument', 'No valid product ids'); }
      
      const productRefs = productIds.map(id => db.collection('products').doc(id));
      const productSnaps = await db.getAll(...productRefs);
      const productMap = new Map();
      productSnaps.forEach(snap => { if (snap.exists) productMap.set(snap.id, snap.data()); });

      const resolvedItems = [];
      let storeId = null;
      for (const raw of items) {
        const lookupId = raw.productId || raw.id;
        const qty = Math.floor(Number(raw.quantity) || 0);
        if (!lookupId) { await releaseIdemDefinite(); throw new HttpsError('invalid-argument', 'Cart item missing product id'); }
        if (qty < 1 || qty > 99) { await releaseIdemDefinite(); throw new HttpsError('invalid-argument', `Invalid quantity for ${lookupId}`); }
        
        const product = productMap.get(lookupId);
        if (!product) { await releaseIdemDefinite(); throw new HttpsError('failed-precondition', `Product not found: ${lookupId}`); }
        if (product.stock === false) { await releaseIdemDefinite(); throw new HttpsError('failed-precondition', `Product out of stock: ${product.name || lookupId}`); }
        
        if (!storeId) storeId = product.storeId || null;
        else if (product.storeId && product.storeId !== storeId) { await releaseIdemDefinite(); throw new HttpsError('failed-precondition', 'Cart contains items from multiple stores'); }
        
        const activePrice = getActivePriceServerSide(product);
        resolvedItems.push({ id: lookupId, name: product.name || '', price: activePrice, quantity: qty, image: product.image || '', alternate: null });
      }

      if (!storeId) { await releaseIdemDefinite(); throw new HttpsError('failed-precondition', 'Could not determine cart store'); }
      const storeSnap = await db.collection('stores').doc(storeId).get();
      if (!storeSnap.exists) { await releaseIdemDefinite(); throw new HttpsError('failed-precondition', 'Store not found'); }
      const storeName = storeSnap.data().name || '';

      const subtotal = resolvedItems.reduce((s, i) => s + (i.price * i.quantity), 0);
      const itemCount = resolvedItems.reduce((s, i) => s + i.quantity, 0);
      const packagingCount = itemCount > 0 ? Math.ceil(itemCount / 4) : 0;
      const packagingFee = packagingCount * 2.00;
      
      // SERVER-SIDE DELIVERY FEE CALCULATION
      let deliveryFee = 0;
      try {
        const feeResult = await calculateFeeInternal(storeId, deliveryAddress.street, deliveryAddress.lat, deliveryAddress.lng);
        deliveryFee = feeResult.fee;
      } catch (err) {
        logger.error('createCardOrder delivery fee error:', err);
        await releaseIdemDefinite(); 
        throw new HttpsError('failed-precondition', err.message || 'Delivery not available for this address');
      }

      const total = subtotal + packagingFee + deliveryFee;

      let walletUsed = 0, cardAmount = total;
      if (paymentMethod === 'wallet') {
        if (walletBalance < total) { await releaseIdemDefinite(); throw new HttpsError('failed-precondition', 'Insufficient wallet balance'); }
        walletUsed = total; cardAmount = 0;
      } else if (paymentMethod === 'split') {
        walletUsed = Math.min(walletBalance, total);
        cardAmount = total - walletUsed;
        if (cardAmount <= 0) { walletUsed = total; cardAmount = 0; }
      }

      const orderPayload = {
        items: resolvedItems, subtotal, packagingCount, packagingFee, deliveryFee, total,
        walletUsed, cardAmount, paymentMethod,
        customerId: uid, customerName: userData.name || '',
        customerPhone: customerPhone || request.auth.token.phone_number || '',
        customerEmail: userData.email || '',
        deliveryAddress: { street: deliveryAddress.street, lat: Number(deliveryAddress.lat) || 0, lng: Number(deliveryAddress.lng) || 0 },
        timeSlot: { display: timeSlotDisplay }, store: storeName, storeId
      };

      // ---- Test mode ----
      if (testMode) {
        const projectId = process.env.GCLOUD_PROJECT || '';
        const isStaging = projectId.endsWith('-staging') || projectId === 'ghostshopza-staging';
        if (!isStaging) {
          await releaseIdemDefinite();
          logger.error(`Test mode requested but project ${projectId} is not staging. Refusing.`);
          throw new HttpsError('failed-precondition', 'Test mode not available on this environment.');
        }
        const orderRef = db.collection('orders').doc();
        await db.runTransaction(async (tx) => {
          const freshUserSnap = await tx.get(userRef);
          if (!freshUserSnap.exists) throw new HttpsError('failed-precondition', 'User profile not found');
          const freshBalance = Number(freshUserSnap.data().walletBalance || 0);
          let testWalletUsed = 0;
          if (paymentMethod === 'wallet') {
            if (freshBalance < total) throw new HttpsError('failed-precondition', 'Insufficient wallet balance');
            testWalletUsed = total;
          } else if (paymentMethod === 'split') {
            testWalletUsed = Math.min(freshBalance, total);
          }
          tx.set(orderRef, {
            ...orderPayload, walletUsed: testWalletUsed, cardAmount: total - testWalletUsed,
            paymentStatus: 'test_mode', orderStatus: 'confirmed', testMode: true,
            refundedItemIndexes: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
          });
          if (testWalletUsed > 0) {
            tx.update(userRef, { walletBalance: freshBalance - testWalletUsed, updatedAt: FieldValue.serverTimestamp() });
          }
        });
        await idemRef.set({
          uid, status: 'completed', orderId: orderRef.id, pendingOrderId: null,
          redirectUrl: `order-confirmation.html?id=${orderRef.id}`, testMode: true,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return { success: true, orderId: orderRef.id, redirectUrl: `order-confirmation.html?id=${orderRef.id}`, testMode: true };
      }

      // ---- Wallet-only ----
      if (cardAmount <= 0) {
        const orderRef = db.collection('orders').doc();
        await db.runTransaction(async (tx) => {
          const freshUserSnap = await tx.get(userRef);
          if (!freshUserSnap.exists) throw new HttpsError('failed-precondition', 'User profile not found');
          const freshBalance = Number(freshUserSnap.data().walletBalance || 0);
          if (freshBalance < total) throw new HttpsError('failed-precondition', 'Insufficient wallet balance');
          tx.set(orderRef, {
            ...orderPayload, walletUsed: total, cardAmount: 0,
            paymentStatus: 'wallet_paid', orderStatus: 'confirmed',
            paidAt: FieldValue.serverTimestamp(), paymentGateway: 'wallet',
            refundedItemIndexes: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
          });
          tx.update(userRef, { walletBalance: freshBalance - total, updatedAt: FieldValue.serverTimestamp() });
        });
        await idemRef.set({
          uid, status: 'completed', orderId: orderRef.id, pendingOrderId: null,
          redirectUrl: `order-confirmation.html?id=${orderRef.id}`, testMode: false,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return { success: true, orderId: orderRef.id, redirectUrl: `order-confirmation.html?id=${orderRef.id}` };
      }

      // ---- Yoco / split-with-card ----
      const pendingRef = db.collection('pendingOrders').doc();
      const pendingOrderId = pendingRef.id;
      const reservationRef = db.collection('walletReservations').doc(pendingOrderId);

      await db.runTransaction(async (tx) => {
        const freshUserSnap = await tx.get(userRef);
        if (!freshUserSnap.exists) throw new HttpsError('failed-precondition', 'User profile not found');
        const freshBalance = Number(freshUserSnap.data().walletBalance || 0);

        let reservedWallet = 0;
        if (walletUsed > 0) {
          if (freshBalance < walletUsed) throw new HttpsError('failed-precondition', 'Insufficient wallet balance for split payment');
          reservedWallet = walletUsed;
          tx.update(userRef, { walletBalance: freshBalance - reservedWallet, updatedAt: FieldValue.serverTimestamp() });
          tx.set(reservationRef, { pendingOrderId, userId: uid, amount: reservedWallet, status: 'active', createdAt: FieldValue.serverTimestamp() });
        }

        tx.set(pendingRef, {
          ...orderPayload, walletUsed: reservedWallet, cardAmount, orderStatus: 'pending_payment',
          paymentStatus: 'pending', pendingState: 'in_progress', idempotencyKey,
          secretMode: testMode ? 'test' : 'live',
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
        });
      });

      await idemRef.set({ pendingOrderId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

      const secretKey = testMode ? YOCO_TEST_SECRET_KEY.value() : YOCO_LIVE_SECRET_KEY.value();
      const jwtToken = jwt.sign(
        { pendingOrderId, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) },
        secretKey, { algorithm: 'HS256' }
      );
      const baseUrl = 'https://ghostshopza.web.app';
      const successUrl = `${baseUrl}/order-confirmation?token=${encodeURIComponent(jwtToken)}&pending=${encodeURIComponent(pendingOrderId)}`;
      const cancelUrl = `${baseUrl}/checkout`;
      const failureUrl = `${baseUrl}/checkout`;
      const amountCents = Math.round(cardAmount * 100);

      const yocoPayload = {
        amount: amountCents, currency: 'ZAR', successUrl, cancelUrl, failureUrl,
        metadata: { pendingOrderId, customerEmail: userData.email || '', customerPhone: customerPhone || request.auth.token.phone_number || '' }
      };

      let yocoResponse;
      try {
        yocoResponse = await axios.post('https://payments.yoco.com/api/checkouts', yocoPayload, {
          headers: { 'Authorization': `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
          timeout: 20000
        });
      } catch (err) {
        const httpStatus = err.response?.status;
        const isDefinite4xx = Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus < 500;

        if (isDefinite4xx) {
          try {
            await db.runTransaction(async (tx) => {
              const resSnap = await tx.get(reservationRef);
              if (resSnap.exists && resSnap.data().status === 'active') {
                const userSnap2 = await tx.get(userRef);
                const bal = Number(userSnap2.data().walletBalance || 0);
                tx.update(userRef, { walletBalance: bal + resSnap.data().amount, updatedAt: FieldValue.serverTimestamp() });
                tx.update(reservationRef, { status: 'released', releasedAt: FieldValue.serverTimestamp(), releaseReason: 'yoco_checkout_rejected_4xx' });
              }
              tx.update(pendingRef, { pendingState: 'failed', failureReason: err.response?.data?.message || err.message || 'Yoco rejected request', failureStatus: httpStatus, updatedAt: FieldValue.serverTimestamp() });
            });
          } catch (rbErr) { logger.error('Rollback after Yoco 4xx failure failed:', rbErr); }
          await releaseIdemDefinite();
          const msg = err.response?.data?.message || err.message || 'Payment setup failed';
          logger.error(`Yoco checkout creation rejected (${httpStatus}):`, msg);
          throw new HttpsError('internal', msg);
        }

        await preserveIdemAmbiguous(pendingOrderId, Number.isInteger(httpStatus) ? `yoco_${httpStatus}_ambiguous` : 'yoco_network_ambiguous');
        logger.error(`Yoco checkout creation ambiguous (status=${httpStatus ?? 'no-response'}):`, err.message);
        throw new HttpsError('internal', 'Payment provider did not confirm the checkout. Your pending order has been preserved. Please wait a few minutes and check My Orders before retrying.');
      }

      await pendingRef.update({ checkoutId: yocoResponse.data.id, pendingState: 'pending_payment', yocoStatus: 'created', updatedAt: FieldValue.serverTimestamp() });

      const redirectUrl = yocoResponse.data.redirectUrl;
      await idemRef.set({ uid, status: 'completed', orderId: null, pendingOrderId, redirectUrl, testMode: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });

      logger.info(`[yoco] Pending ${pendingOrderId} created for user ${uid}, cardAmount=R${cardAmount}`);
      return { success: true, pendingOrderId, checkoutId: yocoResponse.data.id, redirectUrl };

    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error('createCardOrder error:', err);
      throw new HttpsError('internal', err.message || 'Could not place order');
    }
  }
);

// ============================================================
//  14. verifyPayment
// ============================================================
exports.verifyPayment = onCall(
  { secrets: [YOCO_TEST_SECRET_KEY, YOCO_LIVE_SECRET_KEY] },
  async (request) => {
    try {
      if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
      const { pendingOrderId, token } = request.data;
      if (!pendingOrderId || !token) throw new HttpsError('invalid-argument', 'Missing pendingOrderId or token');

      const pendingRef = db.collection('pendingOrders').doc(pendingOrderId);
      const pendingSnap = await pendingRef.get();
      if (!pendingSnap.exists) throw new HttpsError('not-found', 'Pending order not found');
      const pd = pendingSnap.data();

      if (!pd.customerId || pd.customerId !== request.auth.uid) throw new HttpsError('permission-denied', 'Not your order');

      const secretMode = pd.secretMode === 'test' ? 'test' : 'live';
      const secretKey = secretMode === 'test' ? YOCO_TEST_SECRET_KEY.value() : YOCO_LIVE_SECRET_KEY.value();

      let decoded;
      try {
        decoded = jwt.verify(token, secretKey, { algorithms: ['HS256'] });
      } catch (err) { throw new HttpsError('permission-denied', 'Invalid payment confirmation token'); }
      if (decoded.pendingOrderId !== pendingOrderId) throw new HttpsError('permission-denied', 'Token does not match this order');

      if (pd.status === 'converted' && pd.convertedOrderId) {
        const orderSnap = await db.collection('orders').doc(pd.convertedOrderId).get();
        return { success: true, orderId: pd.convertedOrderId, orderData: orderSnap.exists ? orderSnap.data() : null, alreadyProcessed: true };
      }
      if (pd.status === 'failed') throw new HttpsError('failed-precondition', 'Payment failed. Please try again.');

      return { success: true, orderId: null, orderData: null, alreadyProcessed: false, pending: true };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('verifyPayment error:', error);
      throw new HttpsError('internal', error.message || 'Failed to verify payment');
    }
  }
);

// ============================================================
//  15. cleanupPendingOrders
// ============================================================
exports.cleanupPendingOrders = onSchedule('0 0 * * *', async () => {
  logger.info('🧹 Starting pending order cleanup (reconciliation-only mode)');
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const staleSnap = await db.collection('pendingOrders').where('createdAt', '<', sevenDaysAgo).get();
    let flagged7d = 0;
    for (const doc of staleSnap.docs) {
      const data = doc.data();
      if (data.status === 'converted' || data.status === 'failed') continue;
      if (data.needsReconciliation) continue;
      await doc.ref.update({
        needsReconciliation: true,
        reconciliationReason: data.checkoutId ? 'stale_pending_with_checkout_id' : 'stale_pending_no_checkout_id',
        reconciliationFlaggedAt: FieldValue.serverTimestamp()
      }).catch(() => {});
      flagged7d++;
    }

    const ambiguousSnap = await db.collection('pendingOrders').where('pendingState', '==', 'in_progress').where('createdAt', '<', oneDayAgo).get();
    let flagged24h = 0;
    for (const doc of ambiguousSnap.docs) {
      const data = doc.data();
      if (data.checkoutId) continue;
      if (data.needsReconciliation) continue;
      await doc.ref.update({
        needsReconciliation: true,
        reconciliationReason: 'ambiguous_yoco_response',
        reconciliationFlaggedAt: FieldValue.serverTimestamp()
      }).catch(() => {});
      flagged24h++;
    }

    logger.info(`🧹 Cleanup complete: flagged_7d=${flagged7d}, flagged_24h=${flagged24h}, released=0 (releases only happen via payment.failed webhook)`);

    if (flagged7d + flagged24h > 0) {
      try {
        await sendPushNotificationToAdmins(
          '⚠️ Pending orders need review',
          `${flagged7d + flagged24h} pending order(s) flagged for reconciliation. Check unmatchedWebhookEvents and the pendingOrders collection.`,
          { type: 'pending_reconciliation' }
        );
      } catch (e) { logger.warn('Admin push for reconciliation failed (non-fatal)', e); }
    }
  } catch (error) { logger.error('❌ Cleanup error:', error); }
});

// ============================================================
//  16. yocoWebhook
// ============================================================
exports.yocoWebhook = onRequest(
  { secrets: [YOCO_WEBHOOK_SIGNING_SECRET] },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const verdict = verifyYocoSignature({ rawBody, headers: req.headers, secret: YOCO_WEBHOOK_SIGNING_SECRET.value() });
    
    if (!verdict.ok) {
      logger.warn(`yocoWebhook rejected: ${verdict.reason}`);
      return res.status(401).send('Invalid signature');
    }

    let event;
    try { event = JSON.parse(rawBody); } catch (err) { return res.status(400).send('Malformed JSON'); }

    const eventId = event?.id;
    const eventType = event?.type;
    const payload = event?.payload;
    if (!eventId || !eventType || !payload) return res.status(400).send('Malformed event');

    if (eventType !== 'payment.succeeded' && eventType !== 'payment.failed') {
      logger.info(`yocoWebhook: ignoring ${eventType}`);
      return res.status(200).send('OK');
    }

    const eventRef = db.collection('processedWebhookEvents').doc(eventId);
    const already = await eventRef.get();
    if (already.exists) {
      logger.info(`yocoWebhook: event ${eventId} already processed`);
      return res.status(200).send('OK');
    }

    const payloadCheckoutId = payload?.metadata?.checkoutId;
    if (!payloadCheckoutId || typeof payloadCheckoutId !== 'string') {
      logger.warn(`yocoWebhook: event ${eventId} has no checkoutId`);
      await db.collection('unmatchedWebhookEvents').doc(eventId).set({ eventId, eventType, reason: 'missing_checkout_id', receivedAt: FieldValue.serverTimestamp() });
      return res.status(200).send('OK');
    }

    // 🔥 FIX: Retry logic for race condition
    let pendingByCheckout = null;
    let retries = 0;
    while (retries < 3) {
      pendingByCheckout = await db.collection('pendingOrders').where('checkoutId', '==', payloadCheckoutId).limit(2).get();
      if (!pendingByCheckout.empty) break;
      
      logger.warn(`yocoWebhook: pending order not found yet for ${payloadCheckoutId}. Retry ${retries + 1}/3...`);
      await new Promise(r => setTimeout(r, 1000)); // Wait 1 second
      retries++;
    }

    if (!pendingByCheckout || pendingByCheckout.empty) {
      logger.error(`yocoWebhook: no pending order found for checkoutId ${payloadCheckoutId} (event ${eventId}) after retries.`);
      await db.collection('unmatchedWebhookEvents').doc(eventId).set({ eventId, eventType, payloadCheckoutId, reason: 'no_matching_pending_order', receivedAt: FieldValue.serverTimestamp() });
      // Return 500 so Yoco retries this webhook later
      return res.status(500).send('No matching pending order');
    }

    if (pendingByCheckout.size > 1) {
      logger.error(`yocoWebhook: checkoutId ${payloadCheckoutId} matches multiple pending orders`);
      await db.collection('unmatchedWebhookEvents').doc(eventId).set({ eventId, eventType, payloadCheckoutId, reason: 'multiple_pending_orders', receivedAt: FieldValue.serverTimestamp() });
      return res.status(200).send('OK');
    }

    const pendingRef = pendingByCheckout.docs[0].ref;
    const pendingOrderId = pendingRef.id;
    const pendingData = pendingByCheckout.docs[0].data();

    // ---- payment.failed ----
    if (eventType === 'payment.failed') {
      try {
        await db.runTransaction(async (tx) => {
          const freshPending = await tx.get(pendingRef);
          if (!freshPending.exists) return;
          const pd = freshPending.data();
          if (pd.status === 'converted') return;
          if (pd.status && pd.status !== 'pending') return;

          let reservationRef = null, reservationSnap = null;
          let userRef = null, userSnap = null;
          if (pd.walletUsed > 0 && pd.customerId) {
            reservationRef = db.collection('walletReservations').doc(pendingOrderId);
            reservationSnap = await tx.get(reservationRef);
            userRef = db.collection('users').doc(pd.customerId);
            userSnap = await tx.get(userRef);
          }
          const eventSnap = await tx.get(eventRef);
          if (eventSnap.exists) return;

          if (reservationRef && reservationSnap && reservationSnap.exists && reservationSnap.data().status === 'active' && userRef && userSnap && userSnap.exists) {
            const bal = Number(userSnap.data().walletBalance || 0);
            tx.update(userRef, { walletBalance: bal + reservationSnap.data().amount, updatedAt: FieldValue.serverTimestamp() });
            tx.update(reservationRef, { status: 'released', releasedAt: FieldValue.serverTimestamp(), releaseReason: 'payment_failed' });
          }
          tx.update(pendingRef, { status: 'failed', failedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
          tx.set(eventRef, { eventId, eventType, processedAt: FieldValue.serverTimestamp(), matched: true, pendingOrderId, outcome: 'failed' });
        });
        logger.info(`yocoWebhook: payment.failed for ${pendingOrderId}`);
        return res.status(200).send('OK');
      } catch (err) {
        logger.error('yocoWebhook: failed transaction:', err);
        return res.status(500).send('Processing error');
      }
    }

    // ---- payment.succeeded: validate ----
    const payloadAmount = Number(payload.amount);
    const payloadCurrency = payload.currency;
    const payloadStatus = payload.status;

    if (payloadStatus !== 'succeeded') {
      await db.collection('unmatchedWebhookEvents').doc(eventId).set({ eventId, eventType, pendingOrderId, reason: 'payload_status_not_succeeded', payloadStatus, receivedAt: FieldValue.serverTimestamp() });
      return res.status(200).send('OK');
    }
    if (payloadCurrency !== 'ZAR') {
      await db.collection('unmatchedWebhookEvents').doc(eventId).set({ eventId, eventType, pendingOrderId, reason: 'currency_mismatch', payloadCurrency, receivedAt: FieldValue.serverTimestamp() });
      return res.status(200).send('OK');
    }
    const expectedCents = Math.round(Number(pendingData.cardAmount || 0) * 100);
    if (payloadAmount !== expectedCents) {
      await db.collection('unmatchedWebhookEvents').doc(eventId).set({ eventId, eventType, pendingOrderId, reason: 'amount_mismatch', expectedCents, payloadAmount, receivedAt: FieldValue.serverTimestamp() });
      await pendingRef.update({ needsReview: true, reviewReason: 'amount_mismatch', reviewFlaggedAt: FieldValue.serverTimestamp() }).catch(() => {});
      return res.status(200).send('OK');
    }

    // ---- Convert ----
    try {
      const result = await db.runTransaction(async (tx) => {
        const freshPending = await tx.get(pendingRef);
        if (!freshPending.exists) throw new Error('pending_disappeared');
        const pd = freshPending.data();

        if (pd.status === 'converted' && pd.convertedOrderId) return { alreadyProcessed: true, orderId: pd.convertedOrderId, customerId: pd.customerId };
        if (pd.status === 'failed') throw new Error('pending_already_failed');
        if (pd.status && pd.status !== 'pending') return { alreadyProcessed: true, orderId: pd.convertedOrderId || null, customerId: pd.customerId };

        let reservationRef = null, reservationSnap = null;
        let userRef = null, userSnap = null;
        if (pd.walletUsed > 0 && pd.customerId) {
          reservationRef = db.collection('walletReservations').doc(pendingOrderId);
          reservationSnap = await tx.get(reservationRef);
          userRef = db.collection('users').doc(pd.customerId);
          userSnap = await tx.get(userRef);
        }
        const eventSnap = await tx.get(eventRef);
        if (eventSnap.exists) return { alreadyProcessed: true, orderId: pd.convertedOrderId || null, customerId: pd.customerId };

        const orderRef = db.collection('orders').doc();
        const orderData = {
          ...pd, paymentStatus: 'paid', orderStatus: 'confirmed',
          paidAt: FieldValue.serverTimestamp(), paymentGateway: 'yoco',
          yocoEventId: eventId, refundedItemIndexes: [],
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
        };
        delete orderData.yocoStatus;
        delete orderData.idempotencyKey;
        delete orderData.pendingState;
        delete orderData.needsReconciliation;
        delete orderData.reconciliationReason;

        tx.set(orderRef, orderData);

        if (reservationRef && reservationSnap && reservationSnap.exists && reservationSnap.data().status === 'active') {
          tx.update(reservationRef, { status: 'consumed', consumedAt: FieldValue.serverTimestamp(), consumedOrderId: orderRef.id });
        } else if (userRef && userSnap && userSnap.exists && pd.walletUsed > 0) {
          const bal = Number(userSnap.data().walletBalance || 0);
          if (bal < pd.walletUsed) throw new Error('insufficient_wallet_at_capture');
          tx.update(userRef, { walletBalance: bal - pd.walletUsed, updatedAt: FieldValue.serverTimestamp() });
        }

        tx.update(pendingRef, { status: 'converted', convertedAt: FieldValue.serverTimestamp(), convertedOrderId: orderRef.id, updatedAt: FieldValue.serverTimestamp() });
        tx.set(eventRef, { eventId, eventType, processedAt: FieldValue.serverTimestamp(), matched: true, pendingOrderId, orderId: orderRef.id, outcome: 'succeeded' });

        return { alreadyProcessed: false, orderId: orderRef.id, customerId: pd.customerId };
      });

      if (!result.alreadyProcessed && result.customerId) {
        try {
          await sendPushNotification(
            result.customerId, '✅ Payment Confirmed',
            `Your order #${result.orderId.slice(-6)} has been paid and confirmed!`,
            { orderId: result.orderId, status: 'confirmed' }
          );
        } catch (e) { logger.warn('yocoWebhook push failed (non-fatal)', e); }
      }

      logger.info(`yocoWebhook: order ${result.orderId} finalised (already=${result.alreadyProcessed})`);
      return res.status(200).send('OK');
    } catch (err) {
      logger.error('yocoWebhook: conversion transaction failed:', err);
      return res.status(500).send('Processing error');
    }
  }
);

// ============================================================
//  17. driverAcceptOrder
// ============================================================
exports.driverAcceptOrder = onCall(async (request) => {
  const phone = requireAuthPhone(request);
  const { orderId } = request.data;
  if (!orderId) throw new HttpsError('invalid-argument', 'Missing orderId');

  const driverRef = db.collection('drivers').doc(phone);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) throw new HttpsError('not-found', 'Driver account not found');
  const driverData = driverSnap.data();
  if (driverData.approved !== true) throw new HttpsError('failed-precondition', 'Driver is not approved');
  if (driverData.suspended === true) throw new HttpsError('failed-precondition', 'Driver account is suspended');

  const orderRef = db.collection('orders').doc(orderId);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found');
  const order = orderDoc.data();

  if (order.orderStatus !== 'packed' && order.orderStatus !== 'ready') throw new HttpsError('failed-precondition', 'Order is not ready for collection');
  if (order.driverId) throw new HttpsError('failed-precondition', 'Order already assigned');

  const driverName = `${driverData.firstName || ''} ${driverData.lastName || ''}`.trim() || driverData.name || driverData.phone || 'Driver';

  await orderRef.update({
    driverId: phone, driverName, driverPhone: phone,
    assignedAt: FieldValue.serverTimestamp(), orderStatus: 'assigned', updatedAt: FieldValue.serverTimestamp()
  });

  if (order.customerId) {
    await sendPushNotification(
      order.customerId, '🚀 Driver Assigned',
      `Your order #${orderId.slice(-6)} has been assigned to ${driverName}. They will collect soon.`,
      { orderId, status: 'assigned' }
    );
  }
  return { success: true };
});

// ============================================================
//  18. driverUpdateOrder
// ============================================================
const DRIVER_ALLOWED_TRANSITIONS = {
  assigned: ['collected'],
  collected: ['on_the_way'],
  on_the_way: ['delivered']
};

exports.driverUpdateOrder = onCall(async (request) => {
  const phone = requireAuthPhone(request);
  const { orderId, status } = request.data;
  if (!orderId || !status) throw new HttpsError('invalid-argument', 'Missing orderId or status');

  const orderRef = db.collection('orders').doc(orderId);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found');
  const order = orderDoc.data();

  if (order.driverId !== phone) throw new HttpsError('permission-denied', 'This order is not assigned to you');

  const currentStatus = order.orderStatus;
  const allowed = DRIVER_ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(status)) {
    throw new HttpsError('failed-precondition', `Cannot transition from ${currentStatus} to ${status}`);
  }

  const updates = { orderStatus: status, updatedAt: FieldValue.serverTimestamp() };
  if (status === 'collected') updates.collectedAt = FieldValue.serverTimestamp();
  if (status === 'on_the_way') updates.onTheWayAt = FieldValue.serverTimestamp();
  if (status === 'delivered') updates.deliveredAt = FieldValue.serverTimestamp();

  await orderRef.update(updates);

  const messages = {
    collected: '📦 Driver has picked up your order!',
    on_the_way: '🚚 Driver is on the way to you!',
    delivered: '✅ Your order has been delivered! 🎉'
  };
  if (order.customerId && messages[status]) {
    await sendPushNotification(order.customerId, `Order ${status.replace('_', ' ')}`, messages[status], { orderId, status });
  }
  return { success: true };
});

// ============================================================
//  19. driverHeartbeat
// ============================================================
exports.driverHeartbeat = onCall(async (request) => {
  const phone = requireAuthPhone(request);
  try {
    await db.collection('drivers').doc(phone).update({ lastSeen: FieldValue.serverTimestamp() });
  } catch (_) {}
  return { success: true };
});

// ============================================================
//  20. driverLogout
// ============================================================
exports.driverLogout = onCall(async (request) => {
  const phone = requireAuthPhone(request);
  try {
    await db.collection('drivers').doc(phone).update({ isOnline: false, lastSeen: null });
  } catch (_) {}
  return { success: true };
});

// ============================================================
//  21. cleanupInactiveDrivers
// ============================================================
exports.cleanupInactiveDrivers = onSchedule('every 5 minutes', async () => {
  const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
  const driversSnap = await db.collection('drivers').where('isOnline', '==', true).where('lastSeen', '<', fiveMinsAgo).get();
  const batch = db.batch();
  driversSnap.forEach(doc => { batch.update(doc.ref, { isOnline: false, lastSeen: null }); });
  await batch.commit();
  logger.info(`Cleaned up ${driversSnap.size} inactive drivers`);
});

// ============================================================
//  22. trackPWAInstall
// ============================================================
exports.trackPWAInstall = onCall(async (request) => {
  if (!request.auth) {
    const { deviceId } = request.data;
    if (deviceId) {
      await db.collection('analytics_installs').add({ deviceId, timestamp: FieldValue.serverTimestamp(), userAgent: request.data.userAgent || 'unknown' });
    }
    return { success: true };
  }
  try {
    await db.collection('analytics_installs').add({ userId: request.auth.uid, timestamp: FieldValue.serverTimestamp(), userAgent: request.data.userAgent || 'unknown' });
    return { success: true };
  } catch (error) {
    logger.error('Track install error:', error);
    return { success: false };
  }
});

// ============================================================
//  23. getInstallStats
// ============================================================
exports.getInstallStats = onCall(async (request) => {
  await requireAdmin(request);
  try {
    const installsSnap = await db.collection('analytics_installs').get();
    const totalInstalls = installsSnap.size;
    const daily = {};
    installsSnap.forEach(doc => {
      const data = doc.data();
      if (data.timestamp) {
        const date = data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
        const key = date.toISOString().split('T')[0];
        daily[key] = (daily[key] || 0) + 1;
      }
    });
    return { success: true, total: totalInstalls, daily, uniqueUsers: new Set(installsSnap.docs.map(d => d.data().userId).filter(Boolean)).size };
  } catch (error) {
    logger.error('Get install stats error:', error);
    throw new HttpsError('internal', error.message);
  }
});

// ============================================================
//  24. requestDriverPayment
// ============================================================
exports.requestDriverPayment = onCall(async (request) => {
  const phone = requireAuthPhone(request);
  try {
    const driverRef = db.collection('drivers').doc(phone);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) throw new HttpsError('not-found', 'Driver account not found');
    const driver = driverSnap.data();
    if (!driver.approved) throw new HttpsError('failed-precondition', 'Driver not approved yet');
    if (driver.suspended) throw new HttpsError('failed-precondition', 'Driver account is suspended');

    const existingSnap = await db.collection('driverPayments').where('driverPhone', '==', phone).where('status', '==', 'requested').limit(1).get();
    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0];
      return { success: true, alreadyRequested: true, paymentId: existing.id, amount: existing.data().amount || 0, requestedAt: existing.data().requestedAt?.toMillis?.() || null };
    }

    let perTrip = 20;
    try {
      const paySettings = await db.collection('settings').doc('driverPay').get();
      if (paySettings.exists) perTrip = Number(paySettings.data().amountPerTrip) || 20;
    } catch (_) {}

    const ordersSnap = await db.collection('orders').where('driverId', '==', phone).where('orderStatus', '==', 'delivered').get();
    const totalEarned = ordersSnap.size * perTrip;
    const alreadyPaid = Number(driver.paidEarnings || 0);
    const unpaid = Math.max(0, totalEarned - alreadyPaid);
    if (unpaid <= 0) throw new HttpsError('failed-precondition', 'No unpaid earnings to request');

    const paymentRef = await db.collection('driverPayments').add({
      driverPhone: phone,
      driverName: driver.name || `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || 'Driver',
      amount: unpaid, perTripRate: perTrip, orderCount: ordersSnap.size,
      status: 'requested', requestedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp()
    });

    return { success: true, alreadyRequested: false, paymentId: paymentRef.id, amount: unpaid, orderCount: ordersSnap.size };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error('Request driver payment error:', error);
    throw new HttpsError('internal', error.message || 'Failed to request payment');
  }
});

// ============================================================
//  25. onRefundRequestCreated
// ============================================================
exports.onRefundRequestCreated = onDocumentCreated('refundRequests/{requestId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const refund = snap.data();
  const requestId = snap.id;
  const userName = refund.userName || refund.userPhone || 'Customer';
  const amount = Number(refund.amount || 0);
  logger.info(`Refund request ${requestId}: R${amount} from ${userName}`);
  try {
    await sendPushNotificationToAdmins('💸 Refund requested', `${userName} requested R${amount.toFixed(2)} refund`, { type: 'refund_request', requestId });
  } catch (err) { logger.error('Admin push for refund failed:', err); }
});

// ============================================================
//  26. onDriverPaymentRequested
// ============================================================
exports.onDriverPaymentRequested = onDocumentCreated('driverPayments/{paymentId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const payment = snap.data();
  if (payment.status !== 'requested') return;
  const paymentId = snap.id;
  const driverName = payment.driverName || payment.driverPhone || 'Driver';
  const amount = Number(payment.amount || 0);
  logger.info(`Driver payment request ${paymentId}: R${amount} for ${driverName}`);
  try {
    await sendPushNotificationToAdmins('💰 Payment requested', `${driverName} requested R${amount.toFixed(2)}`, { type: 'driver_payment_request', paymentId });
  } catch (err) { logger.error('Admin push for driver payment failed:', err); }
});

// ============================================================
//  27. onItemRequestCreated
// ============================================================
exports.onItemRequestCreated = onDocumentCreated('itemRequests/{requestId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const request = snap.data();
  const requestId = snap.id;
  const itemName = request.itemName || 'Unknown item';
  const storeName = request.storeName || 'Unknown store';
  logger.info(`Item request ${requestId}: "${itemName}" for store "${storeName}"`);
  try {
    await sendPushNotificationToAdmins('🛒 Item request', `${itemName} at ${storeName}`, { type: 'item_request', requestId, storeName, itemName });
  } catch (err) { logger.error('Admin push for item request failed:', err); }
});