"""Seed Suraksha Diagnostic with a rich, realistic demo dataset.

    python seed.py           # seed an empty database (safe to re-run)
    python seed.py --force   # wipe and re-seed from scratch

Demo sign-in (Employee ID / password):
    EMP-1001 / Admin@123      Administrator
    EMP-1002 / Manager@123    Centre Manager
    EMP-1003 / Desk@12345     Receptionist
    EMP-1004 / Lab@12345      Lab Technician
"""

import json
import random
import sys
from datetime import date, datetime, timedelta
from backend.models import localdate, localnow, utcnow  # noqa: F401

from backend import create_app
from backend.models import (
    AuditLog,
    Booking,
    BookingItem,
    BookingStatusHistory,
    Invoice,
    Notification,
    PackageItem,
    Patient,
    Payment,
    Product,
    Role,
    ROLE_LABELS,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_CONFIRMED,
    STATUS_LAB,
    STATUS_NO_SHOW,
    STATUS_PENDING,
    STATUS_REPORT,
    STATUS_SAMPLE,
    Setting,
    User,
    db,
)
from backend.services import (
    DEFAULT_SCHEDULE,
    next_booking_no,
    next_invoice_no,
    next_patient_code,
    price_booking,
    generate_slots,
)

random.seed(20261008)

# ---------------------------------------------------------------------------
# Catalogue: (code, name, category, kind, price, cost, sample, tat_hours, prep)
# ---------------------------------------------------------------------------

CATALOGUE = [
    # Hematology
    ("HEM-CBC", "Complete Blood Count (CBC)", "Hematology", "test", 450, 160, "EDTA Blood", 6, ""),
    ("HEM-ESR", "ESR (Westergren)", "Hematology", "test", 180, 60, "EDTA Blood", 4, ""),
    ("HEM-HB", "Hemoglobin Electrophoresis", "Hematology", "test", 850, 340, "EDTA Blood", 48, ""),
    ("HEM-PRIS", "Peripheral Smear", "Hematology", "test", 350, 120, "EDTA Blood", 8, ""),
    ("HEM-PLT", "Platelet Count", "Hematology", "test", 200, 70, "EDTA Blood", 4, ""),
    ("HEM-PT", "Prothrombin Time (PT/INR)", "Hematology", "test", 550, 210, "Citrated Plasma", 8, "Inform doctor if on blood thinners."),
    # Biochemistry
    ("BIO-FBS", "Fasting Blood Sugar", "Biochemistry", "test", 120, 40, "Fluoride Plasma", 3, "10-12 hour fast required."),
    ("BIO-RBS", "Random Blood Sugar", "Biochemistry", "test", 120, 40, "Fluoride Plasma", 3, ""),
    ("BIO-HBA1C", "HbA1c (Glycated Haemoglobin)", "Biochemistry", "test", 650, 240, "EDTA Blood", 12, ""),
    ("BIO-GLT", "Glucose Tolerance Test (GTT)", "Biochemistry", "test", 700, 260, "Fluoride Plasma", 6, "10-12 hour fast required."),
    ("BIO-LFT", "Liver Function Test (LFT)", "Biochemistry", "test", 900, 330, "Serum", 12, "8 hour fast preferred."),
    ("BIO-RFT", "Renal Function Test (RFT)", "Biochemistry", "test", 850, 300, "Serum", 12, "8 hour fast preferred."),
    ("BIO-UREA", "Blood Urea", "Biochemistry", "test", 260, 90, "Serum", 6, ""),
    ("BIO-CR", "Serum Creatinine", "Biochemistry", "test", 250, 90, "Serum", 6, ""),
    ("BIO-URIC", "Uric Acid", "Biochemistry", "test", 300, 110, "Serum", 8, ""),
    ("BIO-ELECT", "Serum Electrolytes (Na/K/Cl)", "Biochemistry", "test", 750, 270, "Serum", 6, ""),
    # Lipids
    ("LIP-TL", "Lipid Profile (Total)", "Lipid Profile", "test", 780, 280, "Serum", 12, "12 hour fast preferred."),
    ("LIP-CHOL", "Total Cholesterol", "Lipid Profile", "test", 300, 100, "Serum", 8, "12 hour fast preferred."),
    ("LIP-TRI", "Triglycerides", "Lipid Profile", "test", 300, 100, "Serum", 8, "12 hour fast preferred."),
    # Thyroid
    ("THY-TSH", "Thyroid Profile (T3/T4/TSH)", "Thyroid", "test", 700, 250, "Serum", 12, "Morning sample preferred."),
    ("THY-TSHO", "TSH (Ultrasensitive)", "Thyroid", "test", 400, 140, "Serum", 12, "Morning sample preferred."),
    ("THY-FT4", "Free T4", "Thyroid", "test", 400, 140, "Serum", 12, ""),
    # Diabetes / Hormones
    ("HOR-INS", "Insulin (Fasting)", "Hormones", "test", 750, 280, "Serum", 24, "10-12 hour fast required."),
    ("HOR-VITD", "Vitamin D (25-OH)", "Hormones", "test", 1600, 620, "Serum", 36, ""),
    ("HOR-VITB12", "Vitamin B12", "Hormones", "test", 1200, 450, "Serum", 36, ""),
    ("HOR-FERR", "Serum Ferritin", "Hormones", "test", 850, 320, "Serum", 24, ""),
    ("HOR-IRON", "Serum Iron & TIBC", "Hormones", "test", 700, 260, "Serum", 24, "Fasting sample preferred."),
    ("HOR-CORT", "Cortisol (Morning)", "Hormones", "test", 950, 360, "Serum", 24, "Sample before 9 AM."),
    # Cardiac
    ("CAR-TROP", "Troponin I (Cardiac)", "Cardiac Markers", "test", 1400, 540, "Serum", 3, "Emergency test - report in 3 hours."),
    ("CAR-CKMB", "CK-MB", "Cardiac Markers", "test", 900, 340, "Serum", 6, ""),
    ("CAR-BNP", "BNP / NT-proBNP", "Cardiac Markers", "test", 2200, 850, "Plasma", 12, ""),
    ("CAR-HOM", "Homocysteine", "Cardiac Markers", "test", 1100, 420, "Plasma", 24, "12 hour fast preferred."),
    # Vitamins & Micro
    ("MIC-CULT", "Urine Culture & Sensitivity", "Microbiology", "test", 650, 240, "Urine", 48, "First morning sample."),
    ("MIC-THRO", "Throat Swab Culture", "Microbiology", "test", 550, 200, "Swab", 48, ""),
    ("MIC-SPUT", "Sputum AFB (3 samples)", "Microbiology", "test", 900, 340, "Sputum", 72, "Collect 3 early morning samples."),
    ("MIC-HBSAG", "HBsAg (Hepatitis B)", "Microbiology", "test", 600, 220, "Serum", 12, ""),
    ("MIC-HCV", "Anti-HCV", "Microbiology", "test", 700, 260, "Serum", 24, ""),
    ("MIC-HIV", "HIV I & II", "Microbiology", "test", 800, 300, "Serum", 24, "Counselling available."),
    # Urine / Pathology
    ("URI-UA", "Urine Routine & Microscopy", "Urine Analysis", "test", 300, 100, "Urine", 4, "First morning sample preferred."),
    ("URI-DA", "Urine Microalbumin", "Urine Analysis", "test", 550, 200, "Urine", 12, ""),
    ("URI-LOC", "Urine Oxalate & Calcium", "Urine Analysis", "test", 600, 220, "24h Urine", 24, "24 hour collection."),
    ("PAT-PAP", "Pap Smear (Liquid Based)", "Pathology", "test", 950, 360, "Cervical Swab", 48, "Avoid intercourse/douching 48h prior."),
    ("PAT-FNA", "FNAC (Fine Needle Aspiration)", "Pathology", "test", 1800, 700, "Tissue", 72, "By appointment only."),
    ("PAT-BX", "Biopsy Histopathology", "Pathology", "test", 2500, 950, "Tissue", 96, "Surgeon to send sample in formalin."),
    # Imaging
    ("RAD-XR", "X-Ray Chest (PA View)", "Radiology", "test", 600, 220, "-", 4, ""),
    ("RAD-USG", "Ultrasound Abdomen (Complete)", "Radiology", "test", 1200, 450, "-", 6, "8 hour fast preferred."),
    ("RAD-USGP", "Ultrasound Pelvis", "Radiology", "test", 1100, 420, "-", 6, "Full bladder required."),
    ("RAD-ECG", "ECG (12 Lead)", "Radiology", "test", 300, 100, "-", 1, ""),
    ("RAD-AMB", "24 Hour Holter Monitoring", "Radiology", "test", 2800, 1050, "-", 48, "Avoid oily skin lotion on chest."),
    # Packages
    ("PKG-BSC", "Basic Health Checkup", "Health Packages", "package", 1999, 720, "Blood + Urine", 24,
     "10-12 hour fast required. Includes CBC, FBS, RFT, LFT, Lipid, Urine Routine."),
    ("PKG-ADV", "Advanced Full Body Checkup", "Health Packages", "package", 4499, 1620, "Blood + Urine", 36,
     "10-12 hour fast required. Includes 28 parameters plus Thyroid & HbA1c."),
    ("PKG-DIA", "Diabetes Care Panel", "Health Packages", "package", 2499, 900, "Blood + Urine", 24,
     "10-12 hour fast required."),
    ("PKG-THY", "Thyroid Complete Panel", "Health Packages", "package", 1799, 640, "Serum", 24, "Morning sample preferred."),
    ("PKG-CAR", "Cardiac Risk Profile", "Health Packages", "package", 3499, 1260, "Serum + Plasma", 36,
     "12 hour fast preferred."),
    ("PKG-WOM", "Women's Wellness Package", "Health Packages", "package", 3999, 1440, "Blood + Urine", 36,
     "10-12 hour fast required."),
    ("PKG-SRF", "Senior Citizen Care Package", "Health Packages", "package", 4999, 1800, "Blood + Urine", 36,
     "10-12 hour fast required. Bring previous reports."),
    ("PKG-FIT", "Corporate Fitness Screen", "Health Packages", "package", 1499, 540, "Blood + Urine", 24,
     "10-12 hour fast required."),
]

# Package components: package code -> [test codes]
PACKAGES = {
    "PKG-BSC": ["HEM-CBC", "BIO-FBS", "BIO-RFT", "BIO-LFT", "LIP-TL", "URI-UA"],
    "PKG-ADV": ["HEM-CBC", "HEM-ESR", "BIO-FBS", "BIO-HBA1C", "BIO-LFT", "BIO-RFT",
                "LIP-TL", "THY-TSH", "URI-UA", "BIO-URIC"],
    "PKG-DIA": ["BIO-FBS", "BIO-HBA1C", "BIO-RFT", "URI-DA", "LIP-TL"],
    "PKG-THY": ["THY-TSH", "THY-FT4"],
    "PKG-CAR": ["LIP-TL", "CAR-CKMB", "CAR-HOM", "BIO-HBA1C", "HEM-CBC"],
    "PKG-WOM": ["HEM-CBC", "BIO-FBS", "LIP-TL", "THY-TSH", "HOR-VITD",
                "HOR-FERR", "URI-UA", "PAT-PAP"],
    "PKG-SRF": ["HEM-CBC", "BIO-FBS", "BIO-LFT", "BIO-RFT", "LIP-TL",
                "THY-TSH", "RAD-XR", "URI-UA"],
    "PKG-FIT": ["HEM-CBC", "BIO-FBS", "LIP-TL", "BIO-LFT", "URI-UA"],
}

STAFF = [
    # (employee_id, name, email, phone, role, designation, password)
    ("EMP-1001", "Aarti Sharma", "aarti.sharma@surakshadx.in",
     "+91 98300 11001", "admin", "Centre Director", "Admin@123"),
    ("EMP-1002", "Rahul Verma", "rahul.verma@surakshadx.in",
     "+91 98300 11002", "manager", "Centre Manager", "Manager@123"),
    ("EMP-1003", "Neha Iyer", "neha.iyer@surakshadx.in",
     "+91 98300 11003", "receptionist", "Front Desk Executive", "Desk@12345"),
    ("EMP-1004", "Vikram Singh", "vikram.singh@surakshadx.in",
     "+91 98300 11004", "technician", "Sr. Lab Technician", "Lab@12345"),
    ("EMP-1005", "Priya Nair", "priya.nair@surakshadx.in",
     "+91 98300 11005", "receptionist", "Front Desk Executive", "Desk@12345"),
    ("EMP-1006", "Imran Khan", "imran.khan@surakshadx.in",
     "+91 98300 11006", "technician", "Lab Technician", "Lab@12345"),
    ("EMP-1007", "Sneha Das", "sneha.das@surakshadx.in",
     "+91 98300 11007", "technician", "Phlebotomist", "Lab@12345"),
    ("EMP-1008", "Arjun Mehta", "arjun.mehta@surakshadx.in",
     "+91 98300 11008", "manager", "Operations Manager", "Manager@123"),
]

FIRST_NAMES = ["Ananya", "Rohit", "Kavya", "Sourav", "Meera", "Debashish", "Tanvi",
               "Abhishek", "Ritu", "Sanjay", "Pallavi", "Nikhil", "Shreya", "Ranjan",
               "Ipsita", "Manoj", "Divya", "Kaushik", "Rina", "Siddharth", "Alok",
               "Moumita", "Gaurav", "Pooja", "Tarun", "Anjali", "Rakesh", "Sharmistha",
               "Vivek", "Nandini", "Aditya", "Smarani", "Pranab", "Rhea", "Yusuf",
               "Bhavna", "Chirag", "Deepika", "Farhan", "Goutami", "Harsh", "Ira",
               "Jatin", "Kalpana", "Lakshmi", "Mihir", "Naina", "Om", "Paromita", "Rahul"]
LAST_NAMES = ["Ghosh", "Banerjee", "Chatterjee", "Mukherjee", "Sen", "Das", "Roy",
              "Kapoor", "Malhotra", "Iyer", "Nair", "Reddy", "Shetty", "Patel",
              "Shah", "Mehta", "Joshi", "Verma", "Singh", "Khan", "Rao", "Gupta"]

STREETS = ["Lakeview Road", "Park Street", "Gariahat Road", "Rashbehari Avenue",
           "Bidhan Sarani", "Jessore Road", "BT Road", "EM Bypass", "Hazra Road",
           "Siliguri Street", "Kankurgachi", "Maniktala Main Road"]
CITIES = ["Kolkata", "Howrah", "Salt Lake", "New Town", "Barrackpore", "Barasat"]
BLOOD = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-", ""]
DISCOUNTS = [0, 0, 0, 0, 100, 150, 200, 250, 300, 500]

NOTES = [
    "", "", "", "", "Patient prefers morning slots.",
    "Requests SMS confirmation.", "Recurring patient - annual checkup.",
    "Vegetarian - advise accordingly.", "History of hypertension.",
    "Diabetic since 2014.", "Reports emailed to employer.", "",
]


def wipe():
    db.session.execute(db.text("PRAGMA foreign_keys=OFF"))
    for table in reversed(db.metadata.sorted_tables):
        db.session.execute(table.delete())
    db.session.commit()


def seed_roles():
    descriptions = {
        "admin": "Full control: users, settings, audit, all operations.",
        "manager": "Reports, pricing, refunds, all booking operations.",
        "receptionist": "Patient registration, bookings and collections.",
        "technician": "Sample collection and lab status updates only.",
    }
    roles = {}
    for name, label in ROLE_LABELS.items():
        role = Role.query.filter_by(name=name).first()
        if role is None:
            role = Role(name=name, label=label, description=descriptions[name])
            db.session.add(role)
            db.session.flush()
        roles[name] = role
    return roles


def seed_settings():
    defaults = {
        "center_name": "Suraksha Diagnostic",
        "center_address": "214, Lakeview Road, Kolkata 700029",
        "center_phone": "+91 33 4000 1200",
        "currency": "₹",
        "cancellation_window_hours": "2",
        "slot_minutes": "30",
        "booking_horizon_days": "180",
        "working_hours": json.dumps(DEFAULT_SCHEDULE),
        "report_ready_tat_alert": "48",
    }
    for key, value in defaults.items():
        if db.session.get(Setting, key) is None:
            db.session.add(Setting(key=key, value=value, label=key.replace("_", " ").title()))


def seed_staff(roles):
    users = []
    for employee_id, name, email, phone, role, designation, password in STAFF:
        user = User(
            employee_id=employee_id,
            name=name,
            email=email,
            phone=phone,
            designation=designation,
            role_id=roles[role].id,
            status="active",
        )
        user.set_password(password)
        user.last_login_at = utcnow() - timedelta(hours=random.randint(1, 72))
        db.session.add(user)
        users.append((role, user))
    db.session.flush()
    return users


def seed_catalogue():
    products = {}
    for code, name, category, kind, price, cost, sample, tat, prep in CATALOGUE:
        product = Product(
            code=code, name=name, category=category, kind=kind,
            price=price, cost=cost, sample_type=sample, tat_hours=tat,
            prep_instructions=prep,
            description=prep or f"{name} performed at Suraksha Diagnostic.",
            active=True,
        )
        db.session.add(product)
        products[code] = product
    db.session.flush()

    for package_code, test_codes in PACKAGES.items():
        for test_code in test_codes:
            target = products.get(test_code)
            if target is not None:
                db.session.add(PackageItem(package_id=products[package_code].id,
                                           test_id=target.id))
    db.session.flush()
    return products


def seed_patients():
    patients = []
    for index in range(60):
        first = FIRST_NAMES[index % len(FIRST_NAMES)]
        last = random.choice(LAST_NAMES)
        if index >= len(FIRST_NAMES):
            first = random.choice(FIRST_NAMES)
        name = f"{first} {last}"
        phone = f"+91 9{random.randint(300000000, 999999999)}"
        dob_year = utcnow().year - random.randint(8, 84)
        dob = date(dob_year, random.randint(1, 12), random.randint(1, 28))
        patient = Patient(
            code=next_patient_code(),
            name=name,
            phone=phone,
            email=f"{first.lower()}.{last.lower()}{index}@example.com",
            dob=dob,
            gender=random.choice(["male", "female"]),
            address=f"{random.randint(1, 400)}, {random.choice(STREETS)}",
            city=random.choice(CITIES),
            blood_group=random.choice(BLOOD),
            allergies=random.choice(["", "", "", "Penicillin", "Dust allergy", "Iodine"]),
            notes=random.choice(NOTES),
            active=True,
        )
        db.session.add(patient)
        patients.append(patient)
    db.session.flush()
    return patients


def seed_bookings(patients, products, staff):
    receptionists = [u for r, u in staff if r == "receptionist"]
    managers = [u for r, u in staff if r == "manager"] + receptionists
    technicians = [u for r, u in staff if r == "technician"]
    active_products = [p for p in products.values() if p.kind != "package"]
    packages = [p for p in products.values() if p.kind == "package"]

    today = localdate()
    bookings = []
    history_entries = []
    created = 0

    for offset in range(-45, 15):
        target = today + timedelta(days=offset)
        slots = [(s, e) for s, e in generate_slots(target)]
        if not slots:
            continue
        random.shuffle(slots)
        wanted = random.randint(3, 6) if offset < 0 else random.randint(1, 4)
        chosen = slots[:wanted]

        for slot_start, slot_end in chosen:
            patient = random.choice(patients)
            creator = random.choice(managers)

            # choose tests / packages
            if random.random() < 0.32:
                picks = [random.choice(packages)]
            else:
                picks = random.sample(active_products, k=random.randint(1, 3))
            discount = random.choice(DISCOUNTS)
            try:
                lines, subtotal, disc, total = price_booking(
                    [p.id for p in picks], discount
                )
            except ValueError:
                continue

            booking_type = "home" if random.random() < 0.25 else "center"
            address = ""
            if booking_type == "home":
                address = (f"{random.randint(1, 400)}, {random.choice(STREETS)}, "
                           f"{random.choice(CITIES)}")

            # status depends on when the appointment sits
            if offset < -1:
                roll = random.random()
                if roll < 0.62:
                    status = STATUS_REPORT
                elif roll < 0.80:
                    status = STATUS_COMPLETED
                elif roll < 0.90:
                    status = STATUS_CANCELLED
                else:
                    status = STATUS_NO_SHOW
            elif offset == -1:
                status = random.choice([STATUS_REPORT, STATUS_COMPLETED,
                                        STATUS_NO_SHOW, STATUS_LAB])
            elif offset == 0:
                hour = int(slot_start[:2])
                if hour < localnow().hour - 2:
                    status = random.choice([STATUS_REPORT, STATUS_COMPLETED,
                                            STATUS_NO_SHOW, STATUS_LAB, STATUS_SAMPLE])
                else:
                    status = random.choice([STATUS_CONFIRMED, STATUS_CONFIRMED,
                                            STATUS_PENDING, STATUS_SAMPLE])
            else:
                status = random.choice([STATUS_CONFIRMED, STATUS_CONFIRMED,
                                        STATUS_CONFIRMED, STATUS_PENDING, STATUS_PENDING])

            priority = "urgent" if random.random() < 0.12 else "routine"
            tech = random.choice(technicians) if random.random() < 0.7 else None

            booking = Booking(
                booking_no=next_booking_no(),
                patient_id=patient.id,
                booking_date=target,
                slot_start=slot_start,
                slot_end=slot_end,
                booking_type=booking_type,
                address=address,
                phone=patient.phone,
                phlebotomist_id=tech.id if tech else None,
                priority=priority,
                status=status,
                subtotal=subtotal,
                discount=disc,
                total=total,
                notes=random.choice(NOTES),
                created_by=creator.id,
                created_at=datetime.combine(target, datetime.min.time()) - timedelta(
                    days=random.randint(0, 6), hours=random.randint(0, 8)
                ),
            )
            if status == STATUS_CANCELLED:
                booking.cancel_reason = random.choice([
                    "Patient travelling", "Rescheduled by centre",
                    "Patient unwell", "Duplicate booking",
                ])
                booking.cancelled_by = creator.id
                booking.cancelled_at = datetime.combine(
                    target, datetime.min.time()
                ) - timedelta(hours=random.randint(2, 30))

            db.session.add(booking)
            db.session.flush()
            bookings.append(booking)

            for line in lines:
                db.session.add(BookingItem(booking_id=booking.id, **line))

            # status history path
            path = [STATUS_PENDING]
            if status in (STATUS_CONFIRMED, STATUS_SAMPLE, STATUS_LAB,
                          STATUS_COMPLETED, STATUS_REPORT):
                path.append(STATUS_CONFIRMED)
            if status == STATUS_SAMPLE:
                path.append(STATUS_SAMPLE)
            if status in (STATUS_LAB, STATUS_COMPLETED, STATUS_REPORT):
                path += [STATUS_SAMPLE, STATUS_LAB]
            if status in (STATUS_COMPLETED, STATUS_REPORT):
                path.append(STATUS_COMPLETED)
            if status == STATUS_REPORT:
                path.append(STATUS_REPORT)
            if status in (STATUS_CANCELLED, STATUS_NO_SHOW):
                path.append(status)

            when = datetime.combine(target, datetime.min.time()) - timedelta(
                days=1, hours=random.randint(1, 6)
            )
            previous = ""
            for step in path:
                history_entries.append(BookingStatusHistory(
                    booking_id=booking.id,
                    from_status=previous,
                    to_status=step,
                    reason="Booking created" if previous == "" else "",
                    user_id=creator.id,
                    created_at=when,
                ))
                previous = step
                when += timedelta(hours=random.randint(2, 14))

            # invoice + payments
            invoice = Invoice(
                invoice_no=next_invoice_no(),
                booking_id=booking.id,
                patient_id=patient.id,
                subtotal=subtotal,
                discount=disc,
                total=total,
                created_at=booking.created_at,
            )
            db.session.add(invoice)
            db.session.flush()

            if status not in (STATUS_CANCELLED,):
                roll = random.random()
                if offset < 0:
                    if roll < 0.70:
                        payments = [(total, "paid")]
                    elif roll < 0.85:
                        payments = [(round(total * 0.5, 2), "paid")]
                    else:
                        payments = []
                elif roll < 0.45:
                    payments = [(total, "paid")]
                elif roll < 0.60:
                    payments = [(round(total * 0.5, 2), "paid")]
                else:
                    payments = []

                for amount, pstatus in payments:
                    if amount <= 0:
                        continue
                    db.session.add(Payment(
                        invoice_id=invoice.id,
                        booking_id=booking.id,
                        amount=amount,
                        method=random.choice(["cash", "card", "upi", "upi", "insurance"]),
                        reference=f"TXN{random.randint(100000, 999999)}",
                        status=pstatus,
                        user_id=creator.id,
                        created_at=booking.created_at,
                    ))
                invoice.sync()
                db.session.flush()

            created += 1

    db.session.add_all(history_entries)
    return bookings, created


def seed_notifications(staff):
    notes = [
        ("Weekly report is ready", "Download the operations summary from Reports.",
         "#/reports", "info", "manager", None),
        ("Stock check reminder", "Verify reagent inventory before month end.",
         "", "warning", "technician", None),
        ("Policy update", "Free cancellation window is now 2 hours before the slot.",
         "#/settings", "info", "receptionist", None),
    ]
    for title, body, link, level, role, user_id in notes:
        db.session.add(Notification(title=title, body=body, link=link,
                                    level=level, role=role, user_id=user_id))
    for _, user in staff[:4]:
        db.session.add(Notification(
            title="Welcome to Suraksha Diagnostic",
            body="Use the sidebar to explore bookings, patients and reports.",
            link="#/dashboard", level="success", user_id=user.id,
        ))


def seed_audit(staff):
    admin = [u for r, u in staff if r == "admin"][0]
    entries = [
        ("system_seeded", "system", "", "Initial demo dataset generated"),
        ("settings_updated", "settings", "", '{"cancellation_window_hours": "2"}'),
        ("catalogue_imported", "product", "", f"{len(CATALOGUE)} tests and packages"),
        ("login", "user", str(admin.id), "Session opened"),
    ]
    now = utcnow()
    for i, (action, entity, entity_id, detail) in enumerate(entries):
        db.session.add(AuditLog(
            user_id=admin.id, action=action, entity=entity, entity_id=entity_id,
            detail=detail, ip="127.0.0.1", created_at=now - timedelta(minutes=30 - i * 5),
        ))


def main():
    force = "--force" in sys.argv
    app = create_app()

    with app.app_context():
        if User.query.first() is not None and not force:
            print("Database already seeded. Use --force to wipe and re-seed.")
            return
        if force:
            wipe()
            print("Cleared existing data.")

        db.create_all()
        seed_settings()
        roles = seed_roles()
        staff = seed_staff(roles)
        products = seed_catalogue()
        patients = seed_patients()
        bookings, created = seed_bookings(patients, products, staff)
        seed_notifications(staff)
        seed_audit(staff)
        db.session.commit()

        print("=" * 62)
        print("  Suraksha Diagnostic - demo data ready")
        print("=" * 62)
        print(f"  Products : {len(CATALOGUE)} tests & packages")
        print(f"  Patients : {len(patients)}")
        print(f"  Bookings : {created}")
        print(f"  Staff    : {len(STAFF)}")
        print("-" * 62)
        print("  Sign in at http://localhost:5000")
        print("    EMP-1001 / Admin@123      (Administrator)")
        print("    EMP-1002 / Manager@123    (Centre Manager)")
        print("    EMP-1003 / Desk@12345     (Receptionist)")
        print("    EMP-1004 / Lab@12345      (Lab Technician)")
        print("=" * 62)


if __name__ == "__main__":
    main()
