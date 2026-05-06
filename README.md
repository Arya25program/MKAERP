#🧾 MKA ERP System

A lightweight, role-based ERP system built to manage operations like products, invoices, approvals, and internal expenditure tracking.

This project focuses on solving real workflow problems with a practical full-stack approach, combining structured data handling with dynamic UI behavior.

⸻

🚀 Current Version

v0.4
Includes role-based navigation, expenditure tracking, and approval workflows.

⸻

✨ Core Features

🔐 Authentication & User Management

* Role-based access system (Employee, Accountant, Owner, Admin)
* User creation, update, and login functionality
* Conditional UI rendering based on user roles

⸻

📦 Product Management

* Add, view, and manage products
* Track pricing, stock, and categories
* Integrated into invoice and sales flow

⸻

📄 Document System (Invoices / Quotes)

* Create structured documents with itemized entries
* Store customer details and references
* Approval workflow for invoices
* JSON-based storage for flexible schema handling

⸻

💸 Expenditure Tracking (v0.3+)

* Log operational expenses (fuel, lunch, petty cash, etc.)
* Attach proof via URL (external storage)
* Track usage context (employee, vehicle, purpose)
* Approval/rejection system with audit fields
* Filtering by employee, vehicle, and expense type

⸻

✅ Approval System

* Centralized approval flow for invoices and expenditures
* Tracks approver and timestamps
* Supports approval and rejection actions

⸻

📱 Role-Based Navigation (v0.4)

* Dynamic bottom navigation (max 4 actions per role)
* Personalized access per user type
* Clean separation of frequently used vs full-access pages

⸻

☰ Smart Navigation Panel

* Slide-in hamburger menu (mobile-first design)
* Displays user profile (name, role, email)
* Full list of accessible pages per user
* Theme toggle and sign-out integration

⸻

🧱 Tech Stack

Frontend

* HTML, CSS, JavaScript
* Dynamic DOM rendering
* Fetch API for backend communication

Backend

* Node.js + Express
* RESTful API architecture

Database

* PostgreSQL (hosted on Neon)
* Structured + JSON hybrid storage

⸻

🔄 System Flow

User Action → Frontend (UI)
            → API Request (Express)
            → Database (PostgreSQL / Neon)
            → Response → UI Update

⸻

🧠 Design Decisions (Important)

1. Proof Storage via URL

Files (receipts, images) are not stored in the database
→ Stored externally (e.g., cloud storage)
→ Only URL is saved

⸻

2. Flexible Document Structure

* items and terms stored as JSON
* Allows dynamic invoice structure without schema changes

⸻

3. Role-Based UI (Frontend Controlled)

* Navigation and page access controlled at UI level
* Backend enforcement planned for future versions

⸻

4. Lightweight Architecture

* No heavy frameworks used
* Focus on clarity and control over abstraction

⸻

⚠️ Known Limitations

* No backend authorization enforcement (frontend-controlled roles)
* File upload system not fully implemented (URL-only)
* Limited validation and error handling
* No pagination or performance optimization for large datasets
* Hardcoded role logic (not yet permission-driven)

---

📌 Future Roadmap

* Backend role-based authorization (secure approvals)
* File upload integration (Cloudinary / S3)
* Permission-based access system (replace hardcoded roles)
* Dashboard analytics (expenses, sales, performance)
* Pagination, search, and filtering enhancements
* Deployment & CI/CD integration

⸻

🧑‍💻 Author

Arya Ramachandran
BTech Student | Developer | Builder

⸻

📢 Final Note

This project is not positioned as a finished ERP system, but as a working, evolving product built through iterative problem-solving.

Each version reflects real challenges encountered and solved—from broken authentication to database integration and UI logic conflicts.
