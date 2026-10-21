import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, radius } from '../../../lib/theme';
import {
  getRefillsPanel,
  toggleRefillPause,
  cancelRefill,
  deleteRefill,
  updateRefillFrequency,
  fulfillRefill,
  fulfillAllRefills,
  updatePatientProfile,
  deletePatientRefills,
  createRefill,
  RefillPatientGroup,
  RefillMedicine,
} from '../../../lib/api/refills';
import {
  getOrders,
  createSpecialOrder,
  updateOrderStatus,
  deleteSpecialOrder,
  SpecialOrder,
} from '../../../lib/api/orders';
import {
  getCreditCustomers,
  payCreditBalance,
  toggleCustomerCredit,
  updateCreditDueDate,
  CreditCustomerItem,
} from '../../../lib/api/credit';
import { searchMedicine } from '../../../lib/api/sales';
import type { SearchMedicineResult } from '../../../lib/api/inventory';
import { stockLevel } from '../../../lib/stock';

const REFILL_CACHE_KEY = 'cached_refill_panel';
const ORDERS_CACHE_KEY = 'cached_special_orders_panel';
const CREDIT_CACHE_KEY = 'cached_credit_customers';

type CrmTab = 'refills' | 'special_orders' | 'credit';

export default function CrmScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<CrmTab>('refills');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Data Sets ───────────────────────────────────────────────────────────────
  const [groups, setGroups] = useState<RefillPatientGroup[]>([]);
  const [orders, setOrders] = useState<SpecialOrder[]>([]);
  const [creditCustomers, setCreditCustomers] = useState<CreditCustomerItem[]>([]);

  // ── Modals State ────────────────────────────────────────────────────────────
  // 1. Refills: Add Refill Modal
  const [showAddRefill, setShowAddRefill] = useState(false);
  const [refillMedSearch, setRefillMedSearch] = useState('');
  const [refillMedResults, setRefillMedResults] = useState<SearchMedicineResult[]>([]);
  const [selectedRefillMed, setSelectedRefillMed] = useState<SearchMedicineResult | null>(null);
  const [refillPatientName, setRefillPatientName] = useState('');
  const [refillPatientPhone, setRefillPatientPhone] = useState('');
  const [refillIntervalDays, setRefillIntervalDays] = useState('30');

  // Refills: Frequency & Patient Editors
  const [freqTarget, setFreqTarget] = useState<RefillMedicine | null>(null);
  const [freqDays, setFreqDays] = useState('30');
  const [editPatient, setEditPatient] = useState<RefillPatientGroup | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  // 2. Special Orders: Add Order Modal
  const [showAddOrder, setShowAddOrder] = useState(false);
  const [orderProduct, setOrderProduct] = useState('');
  const [orderRequester, setOrderRequester] = useState('');
  const [orderPhone, setOrderPhone] = useState('');
  const [orderQty, setOrderQty] = useState('1');
  const [orderPriority, setOrderPriority] = useState<'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');

  // 3. Credit: Payment & Due Date Modals
  const [payingCustomer, setPayingCustomer] = useState<CreditCustomerItem | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [dueDateCustomer, setDueDateCustomer] = useState<CreditCustomerItem | null>(null);
  const [newDueDate, setNewDueDate] = useState('');

  // ── Hydration & Fetching ────────────────────────────────────────────────────
  const loadAll = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const [refillsData, ordersData, creditData] = await Promise.all([
        getRefillsPanel().catch(() => []),
        getOrders().catch(() => []),
        getCreditCustomers().catch(() => []),
      ]);
      setGroups(refillsData);
      setOrders(ordersData);
      setCreditCustomers(creditData);

      AsyncStorage.setItem(REFILL_CACHE_KEY, JSON.stringify(refillsData)).catch(() => {});
      AsyncStorage.setItem(ORDERS_CACHE_KEY, JSON.stringify(ordersData)).catch(() => {});
      AsyncStorage.setItem(CREDIT_CACHE_KEY, JSON.stringify(creditData)).catch(() => {});
    } catch (e) {
      console.warn('Failed to load CRM data:', e);
    } finally {
      if (showSpinner) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Instant paint from local caches (Module contract)
    (async () => {
      try {
        const [cRefills, cOrders, cCredit] = await Promise.all([
          AsyncStorage.getItem(REFILL_CACHE_KEY),
          AsyncStorage.getItem(ORDERS_CACHE_KEY),
          AsyncStorage.getItem(CREDIT_CACHE_KEY),
        ]);
        if (cRefills) setGroups(JSON.parse(cRefills));
        if (cOrders) setOrders(JSON.parse(cOrders));
        if (cCredit) setCreditCustomers(JSON.parse(cCredit));
        if (cRefills || cOrders || cCredit) setLoading(false);
      } catch {}
    })();
    loadAll(true);
  }, [loadAll]);

  const withBusy = async (key: string, fn: () => Promise<any>) => {
    setBusyId(key);
    try {
      await fn();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  // ── Medicine search for Add Refill ──────────────────────────────────────────
  useEffect(() => {
    if (!refillMedSearch.trim() || refillMedSearch.length < 2) {
      setRefillMedResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await searchMedicine(refillMedSearch.trim());
        setRefillMedResults(res.slice(0, 10));
      } catch {
        setRefillMedResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [refillMedSearch]);

  // ── Refill Handlers ─────────────────────────────────────────────────────────
  const handleTogglePause = (med: RefillMedicine) =>
    withBusy(`m-${med.id}`, async () => {
      await toggleRefillPause(med.id);
      loadAll();
    });

  const handleFulfill = (med: RefillMedicine) =>
    withBusy(`m-${med.id}`, async () => {
      await fulfillRefill(med.id);
      loadAll();
    });

  const handleCancelMed = (med: RefillMedicine) => {
    Alert.alert('Cancel Refill Medicine', `Stop tracking "${med.medicine_name}"?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Medicine',
        style: 'destructive',
        onPress: () =>
          withBusy(`m-${med.id}`, async () => {
            await cancelRefill(med.id);
            loadAll();
          }),
      },
    ]);
  };

  const handleDeleteMed = (med: RefillMedicine) => {
    Alert.alert('Delete Refill Entry', `Permanently delete "${med.medicine_name}" from this patient's cycle?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          withBusy(`m-${med.id}`, async () => {
            await deleteRefill(med.id);
            loadAll();
          }),
      },
    ]);
  };

  const handleSaveFrequency = () =>
    withBusy('freq', async () => {
      if (!freqTarget) return;
      const days = parseInt(freqDays, 10);
      if (!days || days <= 0) {
        Alert.alert('Invalid', 'Enter a valid number of days');
        return;
      }
      await updateRefillFrequency(freqTarget.id, days);
      setFreqTarget(null);
      loadAll();
    });

  const handleSavePatient = () =>
    withBusy('patient', async () => {
      if (!editPatient) return;
      if (!editName.trim() || !editPhone.trim()) {
        Alert.alert('Required', 'Patient name and phone are required');
        return;
      }
      await updatePatientProfile({
        customer_id: editPatient.customer_id ?? undefined,
        original_phone: editPatient.patient_phone,
        patient_name: editName.trim(),
        patient_phone: editPhone.trim(),
        language: editPatient.language || 'en',
        next_refill_date: editPatient.next_refill_date,
      });
      setEditPatient(null);
      loadAll();
    });

  const handleCompleteAll = (group: RefillPatientGroup) =>
    withBusy(`all-${group.patient_phone}`, async () => {
      await fulfillAllRefills(group.patient_phone);
      loadAll();
    });

  const handleSellNow = (group: RefillPatientGroup) => {
    const sellable = group.medicines.filter(
      m => m.is_active !== 0 && (m.inventory_id || m.in_stock_qty > 0)
    );
    if (sellable.length === 0) {
      Alert.alert('Nothing in Stock', 'None of this patient\'s refill medicines currently have stock batches.');
      return;
    }
    const items: SearchMedicineResult[] = sellable.map(m => ({
      inventory_id: m.inventory_id || 0,
      medicine_id: m.medicine_id,
      medicine_name: m.medicine_name,
      batch_no: m.batch_no || '',
      expiry_date: m.expiry_date || '',
      quantity: m.in_stock_qty || 0,
      mrp: m.mrp || m.unit_price || 0,
      unit_price: m.unit_price || m.mrp || 0,
      cost_price: 0,
    }));
    AsyncStorage.setItem('billing_cart_add_queue', JSON.stringify(items))
      .then(() => router.push('/(tabs)/billing'))
      .catch(() => {});
  };

  const handleDeletePatient = (group: RefillPatientGroup) => {
    Alert.alert(
      'Delete Patient',
      `Remove ${group.patient_name} and all their refill cycles? This cannot be undone.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            withBusy(`del-${group.patient_phone}`, async () => {
              await deletePatientRefills(group.patient_phone);
              loadAll();
            }),
        },
      ]
    );
  };

  const handleCreateRefillSubmit = () =>
    withBusy('create-refill', async () => {
      if (!selectedRefillMed) {
        Alert.alert('Required', 'Please select a medicine from the search results');
        return;
      }
      if (!refillPatientName.trim() || !refillPatientPhone.trim()) {
        Alert.alert('Required', 'Patient name and 10-digit phone number are required');
        return;
      }
      const days = parseInt(refillIntervalDays, 10) || 30;
      const res = await createRefill({
        medicine_id: selectedRefillMed.medicine_id,
        medicine_name: selectedRefillMed.medicine_name,
        patient_name: refillPatientName.trim(),
        patient_phone: refillPatientPhone.trim(),
        refill_interval_days: days,
      });

      setShowAddRefill(false);
      setSelectedRefillMed(null);
      setRefillMedSearch('');
      setRefillPatientName('');
      setRefillPatientPhone('');
      setRefillIntervalDays('30');

      if (res.isOffline) {
        Alert.alert('Saved Offline', 'Refill queued locally. It will auto-sync once PC is connected.');
      } else {
        Alert.alert('Success', 'Refill cycle created successfully');
      }
      loadAll();
    });

  // ── Special Orders Handlers ─────────────────────────────────────────────────
  const handleCreateOrderSubmit = () =>
    withBusy('create-order', async () => {
      if (!orderProduct.trim()) {
        Alert.alert('Required', 'Medicine / Product name is required');
        return;
      }
      const qtyNum = parseInt(orderQty, 10) || 1;
      const res = await createSpecialOrder({
        product: orderProduct.trim(),
        requester: orderRequester.trim() || 'Walk-in Patient',
        phone: orderPhone.trim(),
        qty: qtyNum,
        priority: orderPriority,
      });

      setShowAddOrder(false);
      setOrderProduct('');
      setOrderRequester('');
      setOrderPhone('');
      setOrderQty('1');
      setOrderPriority('NORMAL');

      if (res.isOffline) {
        Alert.alert('Saved Offline', 'Special order queued locally. It will auto-sync when PC connects.');
      } else {
        Alert.alert('Success', 'Special order recorded successfully');
      }
      loadAll();
    });

  const handleUpdateOrderStatus = (orderId: number, nextStatus: string) =>
    withBusy(`order-status-${orderId}`, async () => {
      await updateOrderStatus(orderId, nextStatus);
      loadAll();
    });

  const handleDeleteOrder = (orderId: number) => {
    Alert.alert('Delete Special Order', 'Remove this shortage order request?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          withBusy(`order-del-${orderId}`, async () => {
            await deleteSpecialOrder(orderId);
            loadAll();
          }),
      },
    ]);
  };

  // ── Credit Ledger Handlers ──────────────────────────────────────────────────
  const handleToggleCredit = (cust: CreditCustomerItem) =>
    withBusy(`credit-toggle-${cust.id}`, async () => {
      const willEnable = cust.credit_enabled !== 1;
      // Optimistic update
      setCreditCustomers(prev =>
        prev.map(c => (c.id === cust.id ? { ...c, credit_enabled: willEnable ? 1 : 0 } : c))
      );
      try {
        await toggleCustomerCredit(cust.id, willEnable);
        Alert.alert(
          willEnable ? 'Credit Unlocked' : 'Credit Blocked',
          `${cust.name}'s credit has been ${willEnable ? 'UNLOCKED (credit sales allowed)' : 'BLOCKED (no credit sales permitted)'}.`
        );
      } catch (err: any) {
        Alert.alert('Error', err?.message || 'Failed to update credit status');
        loadAll();
      }
    });

  const handlePayCreditSubmit = () =>
    withBusy('pay-credit', async () => {
      if (!payingCustomer) return;
      const amt = parseFloat(payAmount);
      if (isNaN(amt) || amt <= 0) {
        Alert.alert('Invalid Amount', 'Enter a valid payment amount');
        return;
      }
      const res = await payCreditBalance(payingCustomer.id, amt, payingCustomer.name);
      setPayingCustomer(null);
      setPayAmount('');
      if (res.isOffline) {
        Alert.alert('Queued Offline', `Payment of ₹${amt.toFixed(2)} queued offline. Will sync when PC connects.`);
      } else {
        Alert.alert('Payment Recorded', res.message || `Collected ₹${amt.toFixed(2)} for ${payingCustomer.name}`);
      }
      loadAll();
    });

  const handleSaveDueDateSubmit = () =>
    withBusy('due-date', async () => {
      if (!dueDateCustomer) return;
      await updateCreditDueDate(dueDateCustomer.id, newDueDate.trim() || null);
      setDueDateCustomer(null);
      setNewDueDate('');
      loadAll();
    });

  // ── Filtered Data Computations ──────────────────────────────────────────────
  const qClean = search.toLowerCase().trim();

  const filteredGroups = useMemo(() => {
    if (!qClean) return groups;
    return groups.filter(
      g =>
        g.patient_name.toLowerCase().includes(qClean) ||
        g.patient_phone.includes(qClean) ||
        g.medicines.some(m => m.medicine_name.toLowerCase().includes(qClean))
    );
  }, [groups, qClean]);

  const filteredOrders = useMemo(() => {
    if (!qClean) return orders;
    return orders.filter(
      o =>
        (o.product && o.product.toLowerCase().includes(qClean)) ||
        (o.medicine_name && o.medicine_name.toLowerCase().includes(qClean)) ||
        (o.requester && o.requester.toLowerCase().includes(qClean)) ||
        (o.phone && o.phone.includes(qClean))
    );
  }, [orders, qClean]);

  const filteredCredit = useMemo(() => {
    if (!qClean) return creditCustomers;
    return creditCustomers.filter(
      c =>
        c.name.toLowerCase().includes(qClean) ||
        c.phone.includes(qClean) ||
        (c.address && c.address.toLowerCase().includes(qClean))
    );
  }, [creditCustomers, qClean]);

  const totalCreditDues = useMemo(
    () => creditCustomers.reduce((acc, c) => acc + (c.credit_balance || 0), 0),
    [creditCustomers]
  );
  const totalBlockedCredit = useMemo(
    () => creditCustomers.filter(c => c.credit_enabled === 0).length,
    [creditCustomers]
  );

  // ── Render Helpers ──────────────────────────────────────────────────────────
  const renderMedicine = (med: RefillMedicine) => {
    const level = stockLevel(med.in_stock_qty || 0);
    const paused = med.is_active === 0;
    return (
      <View key={`med-${med.id}`} style={[styles.medRow, paused && styles.medRowPaused]}>
        <View style={[styles.stockDot, { backgroundColor: level.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.medName} numberOfLines={1}>
            {med.medicine_name}
          </Text>
          <Text style={styles.medMeta}>
            x{med.quantity_needed} · every {med.refill_interval_days}d · stock {med.in_stock_qty || 0}
            {paused ? ' · PAUSED' : ''}
          </Text>
        </View>
        {busyId === `m-${med.id}` ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <View style={styles.medActions}>
            <IconBtn icon={paused ? 'play' : 'pause'} color={colors.warning} onPress={() => handleTogglePause(med)} />
            <IconBtn
              icon="calendar"
              color={colors.info}
              onPress={() => {
                setFreqTarget(med);
                setFreqDays(String(med.refill_interval_days || 30));
              }}
            />
            {!paused && <IconBtn icon="checkmark" color={colors.success} onPress={() => handleFulfill(med)} />}
            <IconBtn icon="close" color={colors.danger} onPress={() => handleCancelMed(med)} />
            <IconBtn icon="trash-outline" color={colors.danger} onPress={() => handleDeleteMed(med)} />
          </View>
        )}
      </View>
    );
  };

  const renderRefillGroup = (group: RefillPatientGroup) => {
    const activeMeds = group.medicines.filter(m => m.is_active !== 0);
    const dueSoon = group.next_refill_date;
    const allBusy = busyId === `all-${group.patient_phone}`;
    return (
      <View key={`grp-${group.patient_phone}`} style={styles.card}>
        <View style={styles.groupHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.titleText}>{group.patient_name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Ionicons name="call" size={11} color={colors.textMuted} />
              <Text style={styles.metaText}>{group.patient_phone}</Text>
              <View style={styles.dateChip}>
                <Ionicons name="calendar-outline" size={9} color={colors.accent} />
                <Text style={styles.dateChipText}>{dueSoon}</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => {
              setEditName(group.patient_name);
              setEditPhone(group.patient_phone);
              setEditPatient(group);
            }}
            style={styles.iconBtnRound}
          >
            <Ionicons name="create-outline" size={15} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: 6 }}>{group.medicines.map(renderMedicine)}</View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}
            onPress={() => handleSellNow(group)}
          >
            <Ionicons name="cart" size={13} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>Sell ({activeMeds.length})</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '44' }]}
            onPress={() => handleCompleteAll(group)}
            disabled={allBusy}
          >
            {allBusy ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <>
                <Ionicons name="checkmark-done" size={13} color={colors.accent} />
                <Text style={[styles.actionBtnText, { color: colors.accent }]}>Fulfill All</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.danger + '12', borderColor: colors.danger + '33' }]}
            onPress={() => handleDeletePatient(group)}
          >
            <Ionicons name="person-remove-outline" size={13} color={colors.danger} />
            <Text style={[styles.actionBtnText, { color: colors.danger }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderSpecialOrder = (order: SpecialOrder) => {
    const status = (order.status || 'Pending').toUpperCase();
    const isPending = status === 'PENDING';
    const isOrdered = status === 'ORDERED';
    const isReady = status === 'READY';
    const isDelivered = status === 'DELIVERED';

    const statusBg =
      isPending ? colors.warning + '20' :
      isOrdered ? colors.info + '20' :
      isReady ? colors.success + '20' : colors.surfaceLight;
    const statusColor =
      isPending ? colors.warning :
      isOrdered ? colors.info :
      isReady ? colors.success : colors.textMuted;

    return (
      <View key={`so-${order.id}`} style={styles.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.titleText}>{order.product || order.medicine_name}</Text>
            <Text style={styles.metaText}>
              Qty: <Text style={{ fontWeight: '700', color: colors.textPrimary }}>{order.qty || 1}</Text>
              {order.priority && order.priority !== 'NORMAL' ? ` · Priority: ${order.priority}` : ''}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <Ionicons name="person-outline" size={11} color={colors.textMuted} />
              <Text style={styles.metaText}>{order.requester || 'Walk-in'}</Text>
              {!!order.phone && (
                <>
                  <Ionicons name="call-outline" size={11} color={colors.textMuted} />
                  <Text style={styles.metaText}>{order.phone}</Text>
                </>
              )}
            </View>
          </View>

          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.badge, { backgroundColor: statusBg, borderColor: statusColor + '55' }]}>
              <Text style={[styles.badgeText, { color: statusColor }]}>{status}</Text>
            </View>
            {!!order.date && <Text style={{ fontSize: 9, color: colors.textMuted }}>{order.date.slice(0, 10)}</Text>}
          </View>
        </View>

        <View style={styles.actionRow}>
          {isPending && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.info + '18', borderColor: colors.info + '44' }]}
              onPress={() => handleUpdateOrderStatus(order.id, 'Ordered')}
            >
              <Ionicons name="cube-outline" size={13} color={colors.info} />
              <Text style={[styles.actionBtnText, { color: colors.info }]}>Mark Ordered</Text>
            </TouchableOpacity>
          )}

          {isOrdered && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.success + '18', borderColor: colors.success + '44' }]}
              onPress={() => handleUpdateOrderStatus(order.id, 'Ready')}
            >
              <Ionicons name="checkmark-circle-outline" size={13} color={colors.success} />
              <Text style={[styles.actionBtnText, { color: colors.success }]}>Mark Ready</Text>
            </TouchableOpacity>
          )}

          {isReady && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}
              onPress={() => handleUpdateOrderStatus(order.id, 'Delivered')}
            >
              <Ionicons name="bag-check-outline" size={13} color={colors.primary} />
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>Mark Delivered</Text>
            </TouchableOpacity>
          )}

          {!isDelivered && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.danger + '12', borderColor: colors.danger + '33' }]}
              onPress={() => handleDeleteOrder(order.id)}
            >
              <Ionicons name="trash-outline" size={13} color={colors.danger} />
              <Text style={[styles.actionBtnText, { color: colors.danger }]}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderCreditCustomer = (cust: CreditCustomerItem) => {
    const isUnlocked = cust.credit_enabled === 1;
    const isBusy = busyId === `credit-toggle-${cust.id}`;
    const balance = cust.credit_balance || 0;

    return (
      <View key={`credit-${cust.id}`} style={styles.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.titleText}>{cust.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Ionicons name="call" size={11} color={colors.textMuted} />
              <Text style={styles.metaText}>{cust.phone}</Text>
              {cust.unpaid_bills_count > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{cust.unpaid_bills_count} bills</Text>
                </View>
              )}
            </View>
            {!!cust.address && (
              <Text style={[styles.metaText, { marginTop: 2 }]} numberOfLines={1}>
                {cust.address}
              </Text>
            )}
            {!!cust.credit_due_date && (
              <Text style={[styles.metaText, { color: colors.accent, marginTop: 3 }]}>
                Due: {cust.credit_due_date.slice(0, 10)}
              </Text>
            )}
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 11, color: colors.textMuted }}>Due Balance</Text>
            <Text style={{ fontSize: 17, fontWeight: '800', color: balance > 0 ? '#F59E0B' : colors.success }}>
              ₹{balance.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Credit Block / Unlock Toggle Switch Banner */}
        <View
          style={[
            styles.toggleBanner,
            {
              backgroundColor: isUnlocked ? colors.success + '14' : colors.danger + '14',
              borderColor: isUnlocked ? colors.success + '44' : colors.danger + '44',
            },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Ionicons
              name={isUnlocked ? 'shield-checkmark' : 'lock-closed'}
              size={15}
              color={isUnlocked ? colors.success : colors.danger}
            />
            <Text
              style={{
                fontSize: 12,
                fontWeight: '700',
                color: isUnlocked ? colors.success : colors.danger,
              }}
            >
              {isUnlocked ? 'Credit Unlocked (POS Allowed)' : 'Credit Blocked (No Credit Sales)'}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.toggleSwitchBtn,
              { backgroundColor: isUnlocked ? colors.danger : colors.success },
            ]}
            onPress={() => handleToggleCredit(cust)}
            disabled={isBusy}
          >
            {isBusy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.toggleSwitchBtnText}>
                {isUnlocked ? 'Block Credit' : 'Unlock Credit'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Credit Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}
            onPress={() => {
              setPayingCustomer(cust);
              setPayAmount(String(cust.credit_balance || ''));
            }}
          >
            <Ionicons name="cash" size={13} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>Collect Payment</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '44' }]}
            onPress={() => {
              setDueDateCustomer(cust);
              setNewDueDate(cust.credit_due_date ? cust.credit_due_date.slice(0, 10) : '');
            }}
          >
            <Ionicons name="calendar-outline" size={13} color={colors.accent} />
            <Text style={[styles.actionBtnText, { color: colors.accent }]}>Set Due Date</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* ── Top Navigation Tabs ──────────────────────────────────────────────── */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'refills' && styles.tabItemActive]}
          onPress={() => setActiveTab('refills')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="repeat"
            size={14}
            color={activeTab === 'refills' ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.tabLabel, activeTab === 'refills' && styles.tabLabelActive]}>Refills</Text>
          {groups.length > 0 && (
            <View style={[styles.tabBadge, activeTab === 'refills' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === 'refills' && styles.tabBadgeTextActive]}>
                {groups.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'special_orders' && styles.tabItemActive]}
          onPress={() => setActiveTab('special_orders')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="cube"
            size={14}
            color={activeTab === 'special_orders' ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.tabLabel, activeTab === 'special_orders' && styles.tabLabelActive]}>
            Special Orders
          </Text>
          {orders.length > 0 && (
            <View style={[styles.tabBadge, activeTab === 'special_orders' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === 'special_orders' && styles.tabBadgeTextActive]}>
                {orders.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'credit' && styles.tabItemActive]}
          onPress={() => setActiveTab('credit')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="card"
            size={14}
            color={activeTab === 'credit' ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.tabLabel, activeTab === 'credit' && styles.tabLabelActive]}>Credit Ledger</Text>
          {creditCustomers.length > 0 && (
            <View style={[styles.tabBadge, activeTab === 'credit' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === 'credit' && styles.tabBadgeTextActive]}>
                {creditCustomers.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Search & Header Action Bar ────────────────────────────────────────── */}
      <View style={styles.searchBarContainer}>
        <View style={styles.searchInputWrap}>
          <Ionicons name="search" size={15} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={
              activeTab === 'refills'
                ? 'Search patient or medicine...'
                : activeTab === 'special_orders'
                ? 'Search product or requester...'
                : 'Search customer name or phone...'
            }
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {activeTab === 'refills' && (
          <TouchableOpacity
            style={styles.primaryAddBtn}
            onPress={() => setShowAddRefill(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.primaryAddBtnText}>Add</Text>
          </TouchableOpacity>
        )}

        {activeTab === 'special_orders' && (
          <TouchableOpacity
            style={styles.primaryAddBtn}
            onPress={() => setShowAddOrder(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.primaryAddBtnText}>Order</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Credit Summary Metric Cards ──────────────────────────────────────── */}
      {activeTab === 'credit' && (
        <View style={styles.creditSummaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Outstanding Dues</Text>
            <Text style={[styles.summaryVal, { color: '#F59E0B' }]}>₹{totalCreditDues.toFixed(2)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Active Accounts</Text>
            <Text style={styles.summaryVal}>{creditCustomers.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Blocked Accounts</Text>
            <Text style={[styles.summaryVal, { color: totalBlockedCredit > 0 ? colors.danger : colors.textPrimary }]}>
              {totalBlockedCredit}
            </Text>
          </View>
        </View>
      )}

      {/* ── Content View / Lists ─────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.stateText}>Loading CRM data...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadAll();
              }}
              tintColor={colors.primary}
            />
          }
        >
          {activeTab === 'refills' &&
            (filteredGroups.length === 0 ? (
              <View style={styles.centerState}>
                <Ionicons name="repeat-outline" size={40} color={colors.textMuted} />
                <Text style={styles.stateText}>
                  {search ? 'No matching refill patients' : 'No refill patients recorded yet.\nTap "+ Add" to create one.'}
                </Text>
              </View>
            ) : (
              filteredGroups.map(renderRefillGroup)
            ))}

          {activeTab === 'special_orders' &&
            (filteredOrders.length === 0 ? (
              <View style={styles.centerState}>
                <Ionicons name="cube-outline" size={40} color={colors.textMuted} />
                <Text style={styles.stateText}>
                  {search ? 'No matching special orders' : 'No shortage / special orders recorded.\nTap "+ Order" to add one.'}
                </Text>
              </View>
            ) : (
              filteredOrders.map(renderSpecialOrder)
            ))}

          {activeTab === 'credit' &&
            (filteredCredit.length === 0 ? (
              <View style={styles.centerState}>
                <Ionicons name="card-outline" size={40} color={colors.textMuted} />
                <Text style={styles.stateText}>
                  {search ? 'No matching credit customers' : 'No customer credit records found.'}
                </Text>
              </View>
            ) : (
              filteredCredit.map(renderCreditCustomer)
            ))}
        </ScrollView>
      )}

      {/* ── MODAL: ADD REFILL ────────────────────────────────────────────────── */}
      <Modal visible={showAddRefill} transparent animationType="slide" onRequestClose={() => setShowAddRefill(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>+ Add Refill Cycle</Text>
              <TouchableOpacity onPress={() => setShowAddRefill(false)}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>1. Select Medicine</Text>
            {selectedRefillMed ? (
              <View style={styles.selectedMedPill}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.selectedMedName}>{selectedRefillMed.medicine_name}</Text>
                  <Text style={styles.selectedMedMeta}>
                    Stock: {selectedRefillMed.quantity || 0} · MRP: ₹{selectedRefillMed.mrp || selectedRefillMed.unit_price}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedRefillMed(null)}>
                  <Ionicons name="close-circle" size={18} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.textInput}
                  placeholder="Type to search medicine..."
                  placeholderTextColor={colors.textMuted}
                  value={refillMedSearch}
                  onChangeText={setRefillMedSearch}
                />
                {refillMedResults.length > 0 && (
                  <View style={styles.searchDropdown}>
                    {refillMedResults.map(item => (
                      <TouchableOpacity
                        key={`sr-${item.medicine_id}-${item.inventory_id}`}
                        style={styles.searchDropdownItem}
                        onPress={() => {
                          setSelectedRefillMed(item);
                          setRefillMedResults([]);
                          setRefillMedSearch('');
                        }}
                      >
                        <Text style={styles.searchDropdownItemName}>{item.medicine_name}</Text>
                        <Text style={styles.searchDropdownItemMeta}>
                          Batch {item.batch_no || '-'} · Stock: {item.quantity || 0}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            <Text style={styles.inputLabel}>2. Patient Name</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Ramesh Kumar"
              placeholderTextColor={colors.textMuted}
              value={refillPatientName}
              onChangeText={setRefillPatientName}
            />

            <Text style={styles.inputLabel}>3. Patient Phone (10 digits)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. 9876543210"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              maxLength={10}
              value={refillPatientPhone}
              onChangeText={setRefillPatientPhone}
            />

            <Text style={styles.inputLabel}>4. Refill Interval</Text>
            <View style={styles.quickPillsRow}>
              {['15', '30', '45', '60'].map(d => (
                <TouchableOpacity
                  key={d}
                  style={[styles.quickPill, refillIntervalDays === d && styles.quickPillActive]}
                  onPress={() => setRefillIntervalDays(d)}
                >
                  <Text style={[styles.quickPillText, refillIntervalDays === d && styles.quickPillTextActive]}>
                    {d} Days
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.surfaceLight }]}
                onPress={() => setShowAddRefill(false)}
              >
                <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
                onPress={handleCreateRefillSubmit}
              >
                <Text style={styles.modalBtnTextPrimary}>Save Refill</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: NEW SPECIAL ORDER ────────────────────────────────────────── */}
      <Modal visible={showAddOrder} transparent animationType="slide" onRequestClose={() => setShowAddOrder(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>+ New Special Order</Text>
              <TouchableOpacity onPress={() => setShowAddOrder(false)}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Medicine / Shortage Item</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Telma 40mg Tab"
              placeholderTextColor={colors.textMuted}
              value={orderProduct}
              onChangeText={setOrderProduct}
            />

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Quantity</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="1"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  value={orderQty}
                  onChangeText={setOrderQty}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Priority</Text>
                <View style={styles.priorityPicker}>
                  {(['NORMAL', 'HIGH', 'URGENT'] as const).map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.priorityPill, orderPriority === p && styles.priorityPillActive]}
                      onPress={() => setOrderPriority(p)}
                    >
                      <Text
                        style={[
                          styles.priorityPillText,
                          orderPriority === p && {
                            color: p === 'URGENT' ? colors.danger : p === 'HIGH' ? colors.warning : colors.primary,
                            fontWeight: '800',
                          },
                        ]}
                      >
                        {p}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <Text style={styles.inputLabel}>Customer / Requester Name</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Suresh Patel"
              placeholderTextColor={colors.textMuted}
              value={orderRequester}
              onChangeText={setOrderRequester}
            />

            <Text style={styles.inputLabel}>Customer Phone (Optional)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="10 digit phone number"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              maxLength={10}
              value={orderPhone}
              onChangeText={setOrderPhone}
            />

            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.surfaceLight }]}
                onPress={() => setShowAddOrder(false)}
              >
                <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
                onPress={handleCreateOrderSubmit}
              >
                <Text style={styles.modalBtnTextPrimary}>Save Order</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: COLLECT CREDIT PAYMENT ───────────────────────────────────── */}
      <Modal visible={!!payingCustomer} transparent animationType="fade" onRequestClose={() => setPayingCustomer(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Collect Credit Payment</Text>
            <Text style={styles.modalSubtitle}>{payingCustomer?.name} · Due: ₹{payingCustomer?.credit_balance?.toFixed(2)}</Text>

            <Text style={styles.inputLabel}>Payment Amount (₹)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={payAmount}
              onChangeText={setPayAmount}
            />

            <View style={styles.quickPillsRow}>
              <TouchableOpacity
                style={styles.quickPill}
                onPress={() => setPayAmount(String(payingCustomer?.credit_balance || ''))}
              >
                <Text style={styles.quickPillText}>Pay Full</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickPill}
                onPress={() => {
                  const half = ((payingCustomer?.credit_balance || 0) / 2).toFixed(2);
                  setPayAmount(String(half));
                }}
              >
                <Text style={styles.quickPillText}>Pay Half (50%)</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.surfaceLight }]}
                onPress={() => setPayingCustomer(null)}
              >
                <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.success }]}
                onPress={handlePayCreditSubmit}
              >
                <Text style={styles.modalBtnTextPrimary}>Confirm Payment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: SET CREDIT DUE DATE ──────────────────────────────────────── */}
      <Modal visible={!!dueDateCustomer} transparent animationType="fade" onRequestClose={() => setDueDateCustomer(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Set Credit Due Date</Text>
            <Text style={styles.modalSubtitle}>{dueDateCustomer?.name}</Text>

            <Text style={styles.inputLabel}>Due Date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              value={newDueDate}
              onChangeText={setNewDueDate}
            />

            <View style={styles.quickPillsRow}>
              {[7, 15, 30].map(days => {
                const d = new Date();
                d.setDate(d.getDate() + days);
                const str = d.toISOString().slice(0, 10);
                return (
                  <TouchableOpacity key={days} style={styles.quickPill} onPress={() => setNewDueDate(str)}>
                    <Text style={styles.quickPillText}>+{days} Days</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.surfaceLight }]}
                onPress={() => setDueDateCustomer(null)}
              >
                <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
                onPress={handleSaveDueDateSubmit}
              >
                <Text style={styles.modalBtnTextPrimary}>Save Date</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: EDIT REFILL FREQUENCY ────────────────────────────────────── */}
      <Modal visible={!!freqTarget} transparent animationType="fade" onRequestClose={() => setFreqTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Refill Cycle Days</Text>
            <Text style={styles.modalSubtitle}>{freqTarget?.medicine_name}</Text>
            <TextInput
              style={styles.textInput}
              value={freqDays}
              onChangeText={setFreqDays}
              keyboardType="numeric"
              placeholder="e.g. 30"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.modalActionRow}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surfaceLight }]} onPress={() => setFreqTarget(null)}>
                <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={handleSaveFrequency}>
                <Text style={styles.modalBtnTextPrimary}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: EDIT PATIENT PROFILE ──────────────────────────────────────── */}
      <Modal visible={!!editPatient} transparent animationType="fade" onRequestClose={() => setEditPatient(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Patient Profile</Text>
            <TextInput
              style={styles.textInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Patient name"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={styles.textInput}
              value={editPhone}
              onChangeText={setEditPhone}
              keyboardType="phone-pad"
              placeholder="Phone"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.modalActionRow}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surfaceLight }]} onPress={() => setEditPatient(null)}>
                <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={handleSavePatient}>
                <Text style={styles.modalBtnTextPrimary}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function IconBtn({ icon, color, onPress }: { icon: any; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.iconBtn} activeOpacity={0.7}>
      <Ionicons name={icon} size={14} color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // Tabs Header
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingHorizontal: spacing.xs,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: colors.primary,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: '800',
  },
  tabBadge: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 10,
  },
  tabBadgeActive: {
    backgroundColor: colors.primary + '22',
  },
  tabBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
  },
  tabBadgeTextActive: {
    color: colors.primary,
  },

  // Search Bar
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    height: 36,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
  },
  primaryAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: radius.sm,
    justifyContent: 'center',
  },
  primaryAddBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },

  // Credit Metric Summary Grid
  creditSummaryGrid: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: spacing.sm,
    paddingTop: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    padding: 8,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '600',
  },
  summaryVal: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 2,
  },

  // Main List
  listContent: {
    padding: spacing.sm,
    paddingBottom: 50,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  stateText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Common Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  titleText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  metaText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accent + '14',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  dateChipText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.accent,
  },
  countBadge: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  countBadgeText: {
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  iconBtnRound: {
    padding: 5,
  },

  // Medicine Rows in Refill
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 7,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  medRowPaused: {
    opacity: 0.55,
  },
  stockDot: {
    width: 8,
    height: 8,
    borderRadius: 8,
  },
  medName: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  medMeta: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  medActions: {
    flexDirection: 'row',
    gap: 3,
  },
  iconBtn: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Action Buttons Row
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },

  // Credit Block / Unlock Banner
  toggleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: 8,
  },
  toggleSwitchBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  toggleSwitchBtnText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: spacing.md,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 4,
    marginTop: 6,
  },
  textInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  quickPillsRow: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: 6,
  },
  quickPill: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    paddingVertical: 6,
    alignItems: 'center',
  },
  quickPillActive: {
    backgroundColor: colors.primary + '20',
    borderColor: colors.primary,
  },
  quickPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  quickPillTextActive: {
    color: colors.primary,
  },
  priorityPicker: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    height: 38,
    alignItems: 'center',
    padding: 2,
    gap: 2,
  },
  priorityPill: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  priorityPillActive: {
    backgroundColor: colors.surfaceLight,
  },
  priorityPillText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
  },
  selectedMedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '14',
    borderWidth: 1,
    borderColor: colors.primary + '44',
    borderRadius: radius.sm,
    padding: 8,
    marginBottom: 6,
  },
  selectedMedName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  selectedMedMeta: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  searchDropdown: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    maxHeight: 140,
    marginBottom: 6,
  },
  searchDropdownItem: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  searchDropdownItemName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  searchDropdownItemMeta: {
    fontSize: 10,
    color: colors.textMuted,
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  modalBtnTextPrimary: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  modalBtnTextSecondary: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
});
