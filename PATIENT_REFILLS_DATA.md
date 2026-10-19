# Patient Refills Backup & Restoration Reference

> **Source Database**: `G:\AI Pharmacy OS\data\app.db.bak_1792406578200` (Created: 19-Oct-2026 16:12:58)
> **Total Active/Tracked Refill Records**: **105** across **53** patients
> **Status**: All records preserved with 100% fidelity. Root cause identified below.

## 🔍 Why Refills Vanished After Migration
1. **The Data Was Never Deleted**: All 105 refill records exist in your database.
2. **Medicine ID Mismatch**: The migration re-imported the medicines catalog, assigning new IDs (e.g., `GLYCOMET 500MG` had ID `1138197`, now ID `6630712`).
3. **UI Filtering**: The app queries refills using `JOIN medicines m ON m.id = pr.medicine_id`. Because the old IDs don't match the new catalog IDs, SQLite filtered out 104 of the 105 rows.
4. **Instant Fix Available**: All 105 medicine names exist in the new catalog. An automated 1-second SQL re-map script can reconnect all 105 refills instantly without manual typing.

---

## 📋 Complete Patient Refill Details (105 Records)

### Mr. ADITYA PISOLKAR (8788567940)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 1 | **VILDAMAC TRIO 500 10 TAB** | 3 | 30 | 2026-11-12 | 2026-10-13 | `pending` | - |
| 2 | **ERITEL 40 15'S** | 2 | 30 | 2026-11-12 | 2026-10-13 | `pending` | TELMISARTAN(40.0 MG) |

### Mr. AKASH JADHAV (9119455972)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 3 | **CLOBA 5MG TAB 15'S** | 2 | 30 | 2026-11-05 | 2026-10-06 | `pending` | CLOBAZAM(5.0 MG) |
| 4 | **TOPAZ 25MG STRIP OF 15 TABLETS** | 2 | 30 | 2026-11-05 | 2026-10-06 | `pending` | TOPIRAMATE(25.0 MG) |

### Mr. AKSHAY HADKE (7057121017)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 5 | **INDERAL LA 20MG STRIP OF 15 TABLETS** | 2 | 8 | 2026-10-25 | 2026-10-17 | `pending` | PROPRANOLOL(20.0 MG) |

### Mr. ALKA GULAB SONAWNE (8767737659)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 6 | **TELMIKIND AM 40MG STRIP OF 10 TABLETS** | 3 | 8 | 2026-10-25 | 2026-10-17 | `pending` | TELMISARTAN(40.0 MG)+AMLODIPINE(5.0 MG) |

### Mr. ANKUSH MORE (8080888043)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 7 | **HHGLIM M 2MG TABLET** | 2 | 29 | 2026-11-06 | 2026-10-08 | `pending` | METFORMIN(500.0 MG)+GLIMEPIRIDE(2.0 MG) |

### Mr. ANUSH TUPE (7038042722)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 8 | **DYNAGLIPT STRIP OF 10 TABLETS** | 3 | 30 | 2026-11-01 | 2026-10-02 | `pending` | TENELIGLIPTIN(20.0 MG) |
| 9 | **GLYCOMET 500MG STRIP OF 10 TABLETS** | 3 | 30 | 2026-11-01 | 2026-10-02 | `pending` | METFORMIN(500.0 MG) |

### Mr. ARTI PAWAR (9834202709)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 10 | **THYRONORM 75MCG TABLET 120'S** | 1 | 95 | 2027-01-06 | 2026-10-03 | `pending` | THYROXINE / LEVOTHYROXINE SODIUM(75.0 MCG) |
| 11 | **THYRONORM 25MCG BOTTLE OF 120 TABLETS** | 1 | 95 | 2027-01-06 | 2026-10-03 | `pending` | THYROXINE(25.0 MCG) |

### Mr. ASHISH BIHADE (8554843575)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 12 | **TELMISTAL A TAB** | 3 | 30 | 2026-10-23 | 2026-10-17 | `pending` | AMLODIPINE+TELMISARTAN |

### Mr. BALWANT SINGH (8390954438)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 13 | **TELVAS AM 40MG TABLET** | 2 | 26 | 2026-11-11 | 2026-10-16 | `pending` | TELMISARTAN(40.0 MG)+AMLODIPINE(5.0 MG) |
| 14 | **METPURE XL 50MG TABLET** | 3 | 26 | 2026-11-11 | 2026-10-16 | `pending` | S METOPROLOL(50.0 MG) |

### Mr. BASIR BHAI (9860305753)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 15 | **TELMAVAC H STRIP OF 15TAB** | 2 | 30 | 2026-11-16 | 2026-10-17 | `pending` | PHAND |

### Mr. BHANUAS RAGUNATH JADHAV (9762433823)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 16 | **FORACORT 400MCG ROTACAPS 30'S** | 1 | 28 | 2026-11-01 | 2026-10-04 | `pending` | BUDESONIDE(400.0 MCG)+FORMOTEROL(6.0 MCG) |

### Mr. DEEPAK BHAGEL (8817896344)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 17 | **PLACIDA STRIP OF 10 TABLETS** | 3 | 27 | 2026-10-30 | 2026-10-03 | `pending` | MELITRACEN(10.0 MG)+FLUPENTIXOL / FLUPENTHIXOL(0.5 MG) |

### Mr. DHANAJI DEVKAR (9850383603)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 18 | **NICARDIA 10MG STRIP OF 10 CAPSULES** | 1 | 28 | 2026-11-02 | 2026-10-05 | `pending` | NIFEDIPINE(10.0 MG) |

### Mr. DYANOBA BHOSLE (9860741820)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 19 | **FORACORT 200MCG ROTACAPS** | 3 | 24 | 2026-10-30 | 2026-10-06 | `pending` | BUDESONIDE(200.0 MCG)+FORMOTEROL(6.0 MCG) |

### Mr. GANESH GOLE (9130425853)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 20 | **FULLFORM 200MCG ROTACAPS 30'S** | 1 | 11 | 2026-10-28 | 2026-10-17 | `pending` | BECLOMETASONE(200.0 MCG)+FORMOTEROL(6.0 MCG) |

### Mr. JADHAV (9730940823)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 21 | **PREVA AS 150MG TABLET** | 2 | 9 | 2026-10-24 | 2026-10-15 | `pending` | CLOPIDOGREL(75.0 MG)+ACETYLSALICYLIC ACID(150.0 MG) |
| 22 | **LIPITAB 10MG STRIP OF 15TAB** | 2 | 9 | 2026-10-24 | 2026-10-15 | `pending` | HBC LIFESCIENCES PVT LTD |
| 23 | **AMLIP 5MG TABLET** | 3 | 9 | 2026-10-24 | 2026-10-15 | `pending` | AMLODIPINE(5.0 MG) |
| 24 | **NEUROBION FORTE TABLET 30'S** | 1 | 9 | 2026-10-24 | 2026-10-15 | `pending` | THIAMINE MONONITRATE(10.0 MG)+VITAMIN B3 / NICOTINIC ACID / NIACIN(45.0 MG)+VITAMIN B12 / MECOBALAMIN / CYNOCOBALAMIN / METHYLCOBALAMIN(15.0 MCG)+CALCIUM PANTOTHENATE(50.0 MG)+VITAMIN B2 / RIBOFLAVIN(10.0 MG)+PYRIDOXINE HYDROCHLORIDE(3.0 MG) |
| 25 | **TOPAMAC 25MG TABLET** | 3 | 9 | 2026-10-24 | 2026-10-15 | `pending` | TOPIRAMATE(25.0 MG) |
| 26 | **FRISIUM 5MG STRIP OF 15 TABLETS** | 1 | 9 | 2026-10-24 | 2026-10-15 | `pending` | CLOBAZAM(5.0 MG) |
| 27 | **EPIVAL SYP 200ML** | 1 | 9 | 2026-10-24 | 2026-10-15 | `pending` | SODIUM VALPROATE(200.0 MG) |

### Mr. KAMAL PAWAR (9890984420)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 28 | **AZORAN 50MG STRIP OF 10 TABLETS** | 2 | 28 | 2026-11-13 | 2026-10-16 | `pending` | AZATHIOPRINE(50.0 MG) |
| 29 | **TEMSAN H 40MG STRIP OF 15 TABLETS** | 2 | 28 | 2026-11-13 | 2026-10-16 | `pending` | TELMISARTAN(40.0 MG)+HYDROCHLOROTHIAZIDE(12.5 MG) |
| 30 | **FOLINEXT STRIP OF 30 TABLETS** | 1 | 28 | 2026-11-13 | 2026-10-16 | `pending` | VITAMIN B9 / FOLIC ACID / FOLATE(5.0 MG)+VITAMIN B12 / MECOBALAMIN / CYNOCOBALAMIN / METHYLCOBALAMIN(750.0 MG) |
| 31 | **GLYCOMET 500MG STRIP OF 10 TABLETS** | 6 | 28 | 2026-11-13 | 2026-10-16 | `pending` | METFORMIN(500.0 MG) |
| 32 | **NAXDOM 500MG TABLET** | 1 | 28 | 2026-11-13 | 2026-10-16 | `pending` | DOMPERIDONE(10.0 MG)+NAPROXEN(500.0 MG) |

### Mr. KAMAT (9766494589)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 33 | **TELMIGEN AM TABLET 10'S** | 3 | 30 | 2026-11-03 | 2026-10-04 | `pending` | TELMISARTAN(40.0 MG)+AMLODIPINE(5.0 MG) |

### Mr. LALASO AWALE (9130902045)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 34 | **ESPIN H TABLET** | 3 | 29 | 2026-11-12 | 2026-10-14 | `pending` | S AMLODIPINE(2.5 MG)+HYDROCHLOROTHIAZIDE(12.5 MG) |
| 35 | **COVERSYL PLUS TAB** | 3 | 29 | 2026-11-12 | 2026-10-14 | `pending` | INDAPAMIDE(1.25 MG)+PERINDOPRIL(4.0 MG) |
| 36 | **VENPRES AMH TABLET** | 3 | 29 | 2026-11-12 | 2026-10-14 | `pending` | TELMISARTAN(40.0 MG)+AMLODIPINE(5.0 MG)+HYDROCHLOROTHIAZIDE(12.5 MG) |

### Mr. LALASO PAWAR (9665010827)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 37 | **STAMLO 5MG STRIP OF 30 TABLETS** | 3 | 30 | 2026-11-09 | 2026-10-10 | `pending` | AMLODIPINE(5.0 MG) |
| 38 | **ECOSPRIN AV 75MG STRIP OF 15 CAPSULES** | 2 | 30 | 2026-11-09 | 2026-10-10 | `pending` | ATORVASTATIN(10.0 MG)+ASPIRIN / ACETYL SALICYLIC ACID(75.0 MG) |
| 39 | **OLMESAR 20MG STRIP OF 15 TABLETS** | 2 | 30 | 2026-11-09 | 2026-10-10 | `pending` | OLMESARTAN MEDOXOMIL(20.0 MG) |

### Mr. MADNE (7757040934)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 40 | **GLYCOMET 500MG STRIP OF 10 TABLETS** | 3 | 15 | 2026-11-01 | 2026-10-17 | `pending` | METFORMIN(500.0 MG) |
| 41 | **GLIMY 1MG STRIP OF 15 TABLETS** | 2 | 15 | 2026-11-01 | 2026-10-17 | `pending` | GLIMEPIRIDE(1.0 MG) |

### Mr. MANDA DUDHAWDE (7776041506)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 42 | **ELTROXIN 100MCG BOTTLE OF 100 TABLETS** | 1 | 110 | 2027-01-26 | 2026-10-08 | `pending` | THYROXINE(100.0 MCG) |

### Mr. MANGAL HUNINGRE (7219631587)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 43 | **METOSARTAN LN 25 STRIP OF 10CAP** | 3 | 30 | 2026-11-07 | 2026-10-08 | `pending` | SUNFLOWER PHARMACEUTICALS |

### Mr. MANGAL KELGANE (8691002208)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 44 | **OLMESAR 20MG STRIP OF 15 TABLETS** | 2 | 30 | 2026-11-08 | 2026-10-09 | `ordered` | OLMESARTAN MEDOXOMIL(20.0 MG) |

### Mr. MANGAL PWAR (9683430299)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 45 | **FORACORT 400MCG ROTACAPS 30'S** | 2 | 30 | 2026-11-06 | 2026-10-07 | `pending` | BUDESONIDE(400.0 MCG)+FORMOTEROL(6.0 MCG) |

### Mr. MANI SANJAY SHINDE (9699100335)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 46 | **CLOPITAB 75MG STRIP OF 15 TABLETS** | 1 | 30 | 2026-11-08 | 2026-10-08 | `pending` | CLOPIDOGREL(75.0 MG) |
| 47 | **LIPIKIND 10MG TAB 15'S** | 2 | 30 | 2026-11-08 | 2026-10-08 | `pending` | ATORVASTATIN(10.0 MG) |
| 48 | **CYRA D STRIP OF  10TAB** | 2 | 30 | 2026-11-08 | 2026-10-08 | `pending` | SYSTOPIC LABORATORIES |

### Mr. MAUSHI (9096405105)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 49 | **TAZLOC BETA 25MG TABLET** | 3 | 30 | 2026-11-17 | 2026-10-01 | `pending` | TELMISARTAN(40.0 MG)+METOPROLOL(25.0 MG) |
| 50 | **THYRONORM 125MCG BOTTLE OF 120 TABLETS** | 1 | 90 | 2027-01-16 | 2026-10-01 | `pending` | THYROXINE(125.0 MCG) |

### Mr. MAYA BHOSLE (9049996382)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 51 | **AMLOKIND 5 TAB 15** | 2 | 27 | 2026-11-14 | 2026-10-18 | `pending` | MANKIND PHARMACEUTICALS LTD |

### Mr. MOHAN BHILARE (7038063385)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 52 | **REJULOL  TM  50 STRIP  10 TABS** | 3 | 23 | 2026-11-09 | 2026-10-17 | `pending` | REJUVENATE LIFE SCIENCES |
| 53 | **ROSYCAP ASP 10MG/75MG CAP 10'S** | 2 | 23 | 2026-11-09 | 2026-10-17 | `pending` | ROSUVASTATIN(10.0 MG)+ACETYLSALICYLIC ACID(75.0 MG) |
| 54 | **REJULOL H 50MG 10 TAB TAB** | 3 | 23 | 2026-11-09 | 2026-10-17 | `pending` | ALKED BIOTECH |

### Mr. MOKASHI (7709463840)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 55 | **ISMO 20MG STRIP OF 30 TABLETS** | 3 | 27 | 2026-11-06 | 2026-09-28 | `notified` | ISOSORBIDE MONONITRATE(20.0 MG) |
| 56 | **VENPRES AMH TABLET** | 3 | 27 | 2026-11-06 | 2026-10-01 | `notified` | TELMISARTAN(40.0 MG)+AMLODIPINE(5.0 MG)+HYDROCHLOROTHIAZIDE(12.5 MG) |

### Mr. RAHUL BARAWKAR (9423575992)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 57 | **ASHOKARISHTA SYRUP 450 ML** | 1 | 30 | 2026-11-15 | 2026-10-16 | `pending` | AYURVEDIC |

### Mr. RATNAKAR (9307409630)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 58 | **TELMA 40MG STRIP OF 15 TABLETS** | 3 | 30 | 2026-11-16 | 2026-10-17 | `pending` | TELMISARTAN(40.0 MG) |

### Mr. SAMARTH JADHAV (7709631544)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 59 | **TOPAMAC 25MG TABLET** | 6 | 10 | 2026-10-26 | 2026-10-15 | `pending` | TOPIRAMATE(25.0 MG) |
| 60 | **FRISIUM 5MG STRIP OF 15 TABLETS** | 2 | 10 | 2026-10-26 | 2026-10-15 | `pending` | CLOBAZAM(5.0 MG) |
| 61 | **EPIVAL SYP 200ML** | 1 | 10 | 2026-10-26 | 2026-10-15 | `pending` | SODIUM VALPROATE(200.0 MG) |

### Mr. SANTROSH PARAB (9004908997)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 62 | **NICOTEX 4 TIN  40TAB** | 2 | 15 | 2026-11-01 | 2026-10-17 | `pending` | CIPLA LIMITED |

### Mr. SEETA BAI SONAWNE (9960836663)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 63 | **TRIGLYNASE 1MG TABLET** | 3 | 30 | 2026-10-21 | 2026-10-17 | `ordered` | GLIMEPIRIDE(1.0 MG)+METFORMIN(500.0 MG)+PIOGLITAZONE(7.5 MG) |

### Mr. SHER BAHADUR (8446170656)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 64 | **GLIMESTAR PM1 TAB** | 3 | 15 | 2026-10-31 | 2026-10-16 | `pending` | GLIMEPIRIDE(1.0 MG)+PIOGLITAZONE(15.0 MG)+METFORMIN(500.0 MG) |

### Mr. SID (9766889869)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 65 | **TAZLOC BETA 25MG TABLET** | 3 | 30 | 2026-10-21 | 2026-10-17 | `pending` | TELMISARTAN(40.0 MG)+METOPROLOL(25.0 MG) |

### Mr. SNEHA (9307408316)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 66 | **HOMIN D3 STRIP OF 10 TABLETS** | 3 | 10 | 2026-10-26 | 2026-10-16 | `pending` | VITAMIN B12 / MECOBALAMIN / CYNOCOBALAMIN / METHYLCOBALAMIN(1.5 MG)+VITAMIN D3 / CHOLECALCIFEROL(200.0 IU)+VITAMIN B9 / FOLIC ACID / FOLATE(5.0 MG)+VITAMIN B6 / PYRIDOXINE(20.0 MG) |
| 67 | **TRANCODOL DT 5MG TABLET** | 3 | 10 | 2026-10-26 | 2026-10-16 | `pending` | HALOPERIDOL(5.0 MG) |
| 68 | **LORANZA MD 1MG TABLET** | 3 | 10 | 2026-10-26 | 2026-10-16 | `pending` | LORAZEPAM(1.0 MG) |
| 69 | **RELIHEXY 2MG TABLET** | 3 | 10 | 2026-10-26 | 2026-10-16 | `pending` | TRIHEXYPHENIDYL / BENZHEXOL HYDROCHLORIDE(2.0 MG) |

### Mr. SONAWNE (9921586988)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 70 | **GLYCIPHAGE VG1 TAB 10'S** | 6 | 19 | 2026-11-06 | 2026-10-18 | `pending` | GLIMEPIRIDE(1.0 MG)+VOGLIBOSE(0.2 MG)+METFORMIN(500.0 MG) |

### Mr. SUBHASH CHANDRA (9834798950)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 71 | **ECOSPRIN AV 75MG STRIP OF 15 CAPSULES** | 2 | 30 | 2026-10-16 | 2026-10-14 | `ordered` | ATORVASTATIN(10.0 MG)+ASPIRIN / ACETYL SALICYLIC ACID(75.0 MG) |
| 72 | **METPURE XL 50MG TABLET** | 6 | 30 | 2026-10-16 | 2026-10-14 | `ordered` | S METOPROLOL(50.0 MG) |
| 73 | **PINOM H 40 MG STRIP OF 15 TABLET** | 2 | 30 | 2026-10-16 | 2026-10-14 | `ordered` | HYDROCHLOROTHIAZIDE(12.5 MG)+OLMESARTAN MEDOXOMIL(40.0 MG) |

### Mr. SUJATA WALKE (7843004395)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 74 | **GLYCIPHAGE 500MG STRIP OF 20 TABLETS** | 2 | 26 | 2026-10-28 | 2026-10-02 | `pending` | METFORMIN(500.0 MG) |
| 75 | **STAMLO 5MG STRIP OF 30 TABLETS** | 1 | 26 | 2026-10-28 | 2026-10-02 | `pending` | AMLODIPINE(5.0 MG) |

### Mr. SUNITA CHAVAN (9689400399)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 76 | **AMNURITE 10MG TABLET** | 3 | 26 | 2026-10-27 | 2026-10-01 | `pending` | VITAMIN B12 / MECOBALAMIN / CYNOCOBALAMIN / METHYLCOBALAMIN(1.5 MG)+AMITRIPTYLINE(10.0 MG) |

### Mr. SUNITA PAWAR (9870247635)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 77 | **GTN SORBITRATE CR 2.6MG BOTTLE OF 30 TABLETS** | 2 | 27 | 2026-11-07 | 2026-10-11 | `pending` | NITROGLYCERIN / GLYCERYL TRINITRATE(2.6 MG) |
| 78 | **ECOSPRIN GOLD 40MG STRIP OF 15CAP** | 2 | 27 | 2026-11-07 | 2026-10-11 | `pending` | USV PVT LIMITED |
| 79 | **NEWTEL 40MG STRIP OF 10 TABLETS** | 3 | 27 | 2026-11-07 | 2026-10-11 | `pending` | TELMISARTAN(40.0 MG) |
| 80 | **ZORYL M 2MG STRIP OF 15 TABLETS** | 1 | 27 | 2026-11-07 | 2026-10-11 | `pending` | METFORMIN(500.0 MG)+GLIMEPIRIDE(2.0 MG) |
| 81 | **ISTAMET XR 500 STRIP OF 15  TAB** | 2 | 27 | 2026-11-07 | 2026-10-11 | `pending` | SUN PHARMA |

### Mr. SUREKHA JAGGANATH GOSAVI (9325932357)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 82 | **TEMSAN 40 STRIP OF 15 TABLETS** | 2 | 30 | 2026-11-08 | 2026-10-09 | `pending` | TELMISARTAN(40.0 MG) |
| 83 | **VENPRES AMH TABLET** | 2 | 30 | 2026-11-08 | 2026-10-09 | `pending` | TELMISARTAN(40.0 MG)+AMLODIPINE(5.0 MG)+HYDROCHLOROTHIAZIDE(12.5 MG) |

### Mr. SUTAR (8806975035)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 84 | **TRIGLYNASE 1MG TABLET** | 3 | 30 | 2026-10-28 | 2026-09-28 | `pending` | GLIMEPIRIDE(1.0 MG)+METFORMIN(500.0 MG)+PIOGLITAZONE(7.5 MG) |

### Mr. TEJAS MANKUMARE (7559365636)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 85 | **HCQS 200MG STRIP OF 15 TABLETS** | 1 | 15 | 2026-11-03 | 2026-10-19 | `pending` | HYDROXYCHLOROQUINE(200.0 MG) |

### Mr. VAISHALI SAGAR CHAVAN (8830491261)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 86 | **DEFIDIN A 5MG TABLET** | 3 | 30 | 2026-10-23 | 2026-10-17 | `pending` | AMLODIPINE(5.0 MG)+ATENOLOL(50.0 MG) |

### Mr. VAISHALI SONAWNE (9623897152)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 87 | **APIQUIS 5 STRIP OF 10 TAB** | 3 | 30 | 2026-11-17 | 2026-10-18 | `pending` | MEDICARE PRODUCTS INC |
| 88 | **TELMIKIND AM 40MG STRIP OF 10 TABLETS** | 2 | 30 | 2026-11-17 | 2026-10-18 | `pending` | TELMISARTAN(40.0 MG)+AMLODIPINE(5.0 MG) |
| 89 | **YOGATEL AM 40MG TAB 15'S** | 2 | 30 | 2026-11-17 | 2026-10-18 | `pending` | TELMISARTAN(40.0 MG)+AMLODIPINE(5.0 MG) |
| 90 | **SEL XL 50MG TABLET 15'S** | 2 | 30 | 2026-11-17 | 2026-10-18 | `pending` | METOPROLOL SUCCINATE(50.0 MG) |
| 91 | **TAMPIL D CAPSULE 10** | 3 | 30 | 2026-11-17 | 2026-10-18 | `pending` | HIGLANCE LABORATORIES PVT LTD |

### Mr. VANDANA MOKASHI (9881858916)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 92 | **METPURE XL 25MG STRIP OF 10 TABLETS** | 3 | 15 | 2026-10-27 | 2026-10-12 | `pending` | S METOPROLOL(25.0 MG) |

### Mr. VIKRANT KUNTE (9356633094)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 93 | **ECOSPRIN GOLD 20MG STRIP OF 15 CAPSULES** | 2 | 30 | 2026-10-28 | 2026-09-28 | `pending` | ACETYLSALICYLIC ACID(75.0 MG)+CLOPIDOGREL(75.0 MG)+ATORVASTATIN(20.0 MG) |
| 94 | **STAMLO 5MG STRIP OF 30 TABLETS** | 1 | 30 | 2026-10-28 | 2026-09-28 | `pending` | AMLODIPINE(5.0 MG) |

### Mr. VISHAB BHISE (9923777352)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 95 | **LEVIPIL 1GM TABLET** | 1 | 30 | 2026-11-15 | 2026-10-16 | `pending` | LEVETIRACETAM(1.0 G) |
| 96 | **LAMETEC DT 100MG TABLET** | 3 | 30 | 2026-11-15 | 2026-10-16 | `pending` | LAMOTRIGINE(100.0 MG) |
| 97 | **LAMETEC 25DT TAB 10TAB** | 4 | 30 | 2026-11-15 | 2026-10-16 | `pending` | ALKEM LABORATORIES LTD |

### Mr. VIVEK INGULKAR 4343 (9960996072)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 98 | **GLEMPA 10 STRIP OF 10TAB** | 3 | 30 | 2026-11-17 | 2026-10-18 | `pending` | GLENMARK PHARMACEUTICALS |
| 99 | **MET XL 25MG TABLET 20'S** | 1 | 30 | 2026-11-17 | 2026-10-18 | `pending` | METOPROLOL(25.0 MG) |
| 100 | **ECOSPRIN GOLD 20MG CAP 10`S** | 2 | 30 | 2026-11-17 | 2026-10-18 | `pending` | ACETYLSALICYLIC ACID(75.0 MG)+CLOPIDOGREL(75.0 MG)+ATORVASTATIN(20.0 MG) |
| 101 | **SACU V 50 STRIP OF 10TAB** | 2 | 30 | 2026-11-17 | 2026-10-18 | `pending` | GLENMARK PHARMACEUTICALS LTD. |

### Mrs. MANGALA SHIRGONKAR (9689410016)
| # | Medicine Name | Qty | Interval (Days) | Next Refill Date | Last Refill Date | Status | Generic / Notes |
|---|---------------|-----|-----------------|------------------|------------------|--------|-----------------|
| 102 | **PANKREOFLAT STRIP OF 15 TABLETS** | 4 | 9 | 2026-10-24 | 2026-10-15 | `pending` | PANCREATIN(170.0 MG)+ACTIVATED DIMETHICONE(80.0 MG) |
| 103 | **NEW LIVFIT TAB** | 6 | 9 | 2026-10-24 | 2026-10-15 | `pending` | AYURVEDIC |
| 104 | **BUSCOGAST STOMACH PAIN SPECIALIST - STRIP OF 10 TABLETS** | 6 | 9 | 2026-10-24 | 2026-10-15 | `pending` | HYOSCINE BUTYLBROMIDE(10.0 MG) |
| 105 | **EPTION 100MG TAB 120 TAB** | 1 | 9 | 2026-10-24 | 2026-10-15 | `pending` | ABBOTT HEALTHCARE PVT LTD |

