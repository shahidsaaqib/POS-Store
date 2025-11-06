/* ===========================
   LOGIN & RBAC (FIXED & UPDATED)
   =========================== */

/* Hardcoded USERS (change later to Supabase-auth or a users table) */
const USERS = {
  admin:   { password: "admin123", role: "Admin" },
  manager: { password: "manager123", role: "Manager" },
  cashier: { password: "cashier123", role: "Cashier" }
};

let CURRENT_USER_ROLE = null; // Will be set after successful login

/* helper */
const $ = id => document.getElementById(id);

/* handle login - RESTUCTURED FOR ROBUST HARDCODED LOGIN */
async function handleLogin(){
  const username = $('loginUser').value.trim().toLowerCase();
  const password = $('loginPass').value.trim();

  $('loginError').style.display = 'none'; // Hide previous error
  let success = false;
  
  // 1. Try Hardcoded Users (Test Credentials)
  const user = USERS[username];
  if (user && user.password === password) {
    CURRENT_USER_ROLE = user.role;
    success = true;
    console.log("HARDCODED LOGIN SUCCESS: " + username); // Debug line
  } 
  
  // 2. If Hardcoded failed, attempt Supabase check (only if not already successful)
  if (!success) {
    const { data: supabaseUser, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .maybeSingle();

    if (supabaseUser && !error) {
        CURRENT_USER_ROLE = supabaseUser.role;
        success = true;
    }
  }

  if (success) {
    // --- Login Success Block ---
    // DEBUG ALERT (Removed as per user request to stop bar-bar popup)
    
    $('loginScreen').style.display = 'none';
    document.querySelector('header').style.display = 'flex';
    document.querySelector('.app').style.display = 'flex';
    
    // Optional: show username in header
    document.getElementById('projectStatus').textContent =
        `Logged in as ${username} (${CURRENT_USER_ROLE})`;

    // Apply permissions and initialize the app's data
    applyRolePermissions();
    init();
  } else {
    // --- Login Failure Block ---
    $('loginError').style.display = 'block';
    alert("Login failed! Ensure you are using the correct credentials (Test: admin/admin123) or that your Supabase 'users' table is correctly configured.");
  }
}

/* apply role-based visibility and controls */
function applyRolePermissions(){
  const role = CURRENT_USER_ROLE;
  // Sidebar buttons
  document.querySelectorAll('aside .nav-btn').forEach(btn=>{
    // extract tab id from onclick: navigate('tab', this)
    const onclick = btn.getAttribute('onclick') || '';
    const match = onclick.match(/'(.*?)'/);
    const tab = match ? match[1] : null;
    let show = false;
    if(role === 'Admin') show = true;
    if(role === 'Manager') show = ['dashboard','inventory','suppliers','sales','reports','purchase'].includes(tab);
    if(role === 'Cashier') show = ['sales','refunds'].includes(tab);
    btn.style.display = show ? 'block' : 'none';
  });

  // Sections in main
  document.querySelectorAll('main section').forEach(sec=>{
    const id = sec.id;
    let show = false;
    if(role === 'Admin') show = true;
    if(role === 'Manager') show = ['dashboard','inventory','suppliers','sales','reports','purchase'].includes(id);
    if(role === 'Cashier') show = ['sales','refunds'].includes(id);
    sec.style.display = show ? '' : 'none';
  });

  // Add logout button to header (if not exists)
  if(!document.getElementById('logoutBtn')){
    const btn = document.createElement('button');
    btn.id = 'logoutBtn';
    btn.textContent = 'Logout (' + role + ')';
    btn.style.marginLeft = 'auto';
    btn.onclick = () => {
      // Simple way to return to login and clear state
      location.reload(); 
    };
    document.querySelector('header').appendChild(btn);
  } else {
    document.getElementById('logoutBtn').textContent = 'Logout (' + role + ')';
  }

  // Navigate to the user's default screen
  if (role === 'Admin' || role === 'Manager') {
    navigate('dashboard', document.querySelector('aside .nav-btn'));
  } else if (role === 'Cashier') {
    navigate('sales', document.querySelector('aside button[onclick*="sales"]'));
  }
}

/* ===========================
   ORIGINAL JS — Supabase + POS logic
   =========================== */

/* ---------------- CONFIG — REPLACE THESE ---------------- */
// IMPORTANT: Replace these with your actual Supabase project credentials.
const SUPABASE_URL = "https://iaynhnzstqhvgrjytcfv.supabase.co"; 
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlheW5obnpzdHFodmdyanl0Y2Z2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1ODU3MDgsImV4cCI6MjA3NzE2MTcwOH0.65XVq_KfdrMbwxUJ6v-lw3w-86j3ueM5U15kaNd4JT8"; 
/* ------------------------------------------------------ */

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* State */
let cart = [];
let productsCache = [];
let suppliersCache = [];
let currentEditingProductId = null; // State for tracking which product is being edited

/* UTIL */
const fmt = n => (Number(n)||0).toFixed(2);

// Helper: Converts a Date object to the format required by datetime-local input (YYYY-MM-DDTHH:MM)
function getLocalDatetimeString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/* ---------------- DATE UTILS (TIMEZONE FIX) ---------------- */
// FIX: Returning a local ISO string (without 'Z') to force Supabase to respect the local date boundaries.

// Helper: Gets the precise start of the local day (00:00:00.000), formatted WITHOUT the 'Z' 
// to force the database to respect the local date boundary for comparison.
function getStartOfDay(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0); 
    
    // Generate YYYY-MM-DDT00:00:00.000 string
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const milliseconds = String(d.getMilliseconds()).padStart(3, '0');
    // Return a local timestamp string without the 'Z' (Zulu time indicator)
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`;
}

// Helper: Gets the precise end of the local day (23:59:59.999), formatted WITHOUT the 'Z'
function getEndOfDay(date = new Date()) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999); 
    
    // Generate YYYY-MM-DDT23:59:59.999 string
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const milliseconds = String(d.getMilliseconds()).padStart(3, '0');
    // Return a local timestamp string without the 'Z' (Zulu time indicator)
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/* NAV */
function navigate(tab, btn){
  document.querySelectorAll('aside .nav-btn').forEach(b=>b.classList.remove('active'));
  
  // Ensure the correct button in the sidebar is activated
  let activeBtn = btn;
  if(btn && !btn.classList.contains('nav-btn')) {
    activeBtn = document.querySelector(`aside button[onclick*="'${tab}'"]`);
  }
  if(activeBtn) activeBtn.classList.add('active');

  document.querySelectorAll('main section').forEach(s=>s.classList.remove('active'));
  const sec = $(tab);
  if(sec) sec.classList.add('active');
  
  // load data per tab
  if(tab==='dashboard') loadDashboard();
  if(tab==='inventory') { loadSuppliers(); loadProducts(); }
  if(tab==='sales') { loadProducts(); prepareSaleForm(); }
  if(tab==='suppliers') loadSuppliers();
  if(tab==='refunds') { loadProducts(); loadRefunds(); }
  if(tab==='history') loadSalesHistory();
  if(tab==='reports') {}
  if(tab==='purchase') loadDashboard();
}

function checkAccessControls(){
  // No action needed here, as RBAC is handled in applyRolePermissions()
  // This function remains as a placeholder if more granular UI controls are needed
}

/* ---------------- LOAD / CRUD - Suppliers ---------------- */

async function loadSuppliers(){
  const { data, error } = await supabase.from('suppliers').select('*').order('id',{ascending:true});
  if(error) return console.error("loadSuppliers Error:", error.message || error);
  suppliersCache = data || [];
  if($('suppliersTable')) renderSuppliersTable();
  populateSelects(); // Important: must call populateSelects so products can link to suppliers
}

async function addSupplier(){
  const name = $('s_name').value.trim();
  if(!name) return alert('Enter supplier name');
  
  const { error } = await supabase.from('suppliers').insert([{
    name,
    contact: $('s_contact').value,
    email: $('s_email').value,
    notes: $('s_notes').value
  }]);
  
  if(error) return alert(error.message);
  alert('Supplier added successfully!');
  
  // Clear form
  $('s_name').value = '';
  $('s_contact').value = '';
  $('s_email').value = '';
  $('s_notes').value = '';
  
  loadSuppliers();
}

async function deleteSupplier(id){
  if(!confirm('Are you sure you want to delete this supplier?')) return;
  const { error } = await supabase.from('suppliers').delete().eq('id', id);
  if(error) return alert(error.message);
  loadSuppliers();
}

function renderSuppliersTable(){
  const tbody = $('suppliersTable').querySelector('tbody');
  tbody.innerHTML = suppliersCache.map(s=>`
    <tr>
      <td>${s.name}</td>
      <td>${s.contact||''}</td>
      <td>${s.email||''}</td>
      <td>${s.notes||''}</td>
      <td><button class="small" onclick="deleteSupplier(${s.id})" style="background:#dc2626">Del</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5">No suppliers added.</td></tr>';
}

function populateSelects(){
  const selects = document.querySelectorAll('#p_supplier, #inventorySupplierFilter');
  const options = ['<option value="">-- Select Supplier --</option>']
    .concat(suppliersCache.map(s=>`<option value="${s.id}">${s.name}</option>`)).join('');
    
  selects.forEach(sel => {
    // Only update if not currently editing (to preserve selection in edit mode)
    // In this simple case, we just re-render everything
    const currentValue = sel.value; 
    sel.innerHTML = options;
    if(currentValue) sel.value = currentValue; // Try to restore selection
  });
}

/* ---------------- LOAD / CRUD - Products ---------------- */

// Load products, and 'join' with suppliers data
async function loadProducts(){
  // Fetch products and their related supplier data
  const { data, error } = await supabase
    .from('products')
    .select('*, suppliers(name)')
    .order('id',{ascending:true});
    
  if(error) return console.error("loadProducts Error:", error.message || error);

  // Cache data and handle the joined table name
  productsCache = (data || []).map(p => ({
    ...p,
    // Flatten the supplier name for easier access
    supplier_name: p.suppliers ? p.suppliers.name : ''
  })); 
  
  // Initial render of the main inventory table and sales select
  // if($('productsTable')) renderProductsTable(); // <-- BUG FIX: Removed redundant call
  renderSaleProductSelect(productsCache);
  
  // Update the inventory supplier filter's options (if needed, but usually handled by populateSelects)
  filterInventory();
}

// Reusable search logic for products
function filterProductsByTerm(products, term){
  if (!term) return products;
  const t = term.toLowerCase();
  return products.filter(p => {
    // Search by name (which includes strength), category (Type), batch, or manufacturer
    return p.name.toLowerCase().includes(t) || 
           p.category.toLowerCase().includes(t) || 
           p.batch_no.toLowerCase().includes(t) || 
           p.manufacturer.toLowerCase().includes(t) ||
           (p.barcode || '').toLowerCase().includes(t); // Check barcode
  });
}

// Function to filter the inventory table (Search & Supplier)
function filterInventory(){
  const searchTerm = $('inventorySearch').value.toLowerCase().trim();
  const supplierId = $('inventorySupplierFilter').value;

  // 1. Use reusable search function
  let filteredProducts = filterProductsByTerm(productsCache, searchTerm);

  // 2. Supplier filter
  if(supplierId) {
    filteredProducts = filteredProducts.filter(p => String(p.supplier_id) === supplierId);
  }

  renderProductsTable(filteredProducts);
}

// Renders the main inventory table
function renderProductsTable(products = productsCache) {
  const tbody = $('productsTable').querySelector('tbody');
  tbody.innerHTML = (products || []).map(p=>`
    <tr>
      <td>${p.name}</td>
      <td>${p.category||''}</td>
      <td>${p.batch_no||''}</td>
      <td>${p.expiry_date||''}</td>
      <td>${p.manufacturer||''}</td>
      <td class="right">Rs. ${fmt(p.purchase_price)}</td>
      <td class="right">Rs. ${fmt(p.selling_price)}</td>
      <td class="right ${p.stock_qty < (p.reorder_point||5) ? 'danger' : ''}">${p.stock_qty}</td>
      <td class="right">${p.reorder_point||5}</td>
      <td>${p.supplier_name||''}</td>
      <td>${p.location||''}</td>
      <td>${p.barcode||''}</td> <td>
        <button class="small" onclick="editProduct(${p.id})">Edit</button>
        <button class="small" onclick="deleteProduct(${p.id})" style="background:#dc2626">Del</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="13">No products found.</td></tr>'; // FIX: Colspan changed to 13
}


// Renders the select box for sales section (with stock and price info)
function renderSaleProductSelect(products){
  const sel = $('saleProductSelect');
  if(!sel) return;
  
  sel.innerHTML = products.filter(p=>p.stock_qty>0).map(p=>
    // The select box displays name, stock, and price
    `<option value="${p.id}" data-price="${fmt(p.selling_price)}" data-stock="${p.stock_qty}">
      ${p.name} (Stock: ${p.stock_qty} / Price: Rs. ${fmt(p.selling_price)})
    </option>`
  ).join('') || '<option value="">No products in stock</option>';
}

// Filters the products shown in the Sales tab select based on the search input
function filterSaleProducts(){
  const term = $('searchSaleProduct').value.trim();
  let filteredProducts = filterProductsByTerm(productsCache, term);
  renderSaleProductSelect(filteredProducts);
}

// Manages the state of the product form (Add vs Edit)
function setProductFormState(id){
  currentEditingProductId = id;
  const btn = $('addProductBtn');
  
  if(id){
    btn.textContent = 'Update Product';
    const p = productsCache.find(x=>x.id===id);
    if(!p) return;
    
    // Set form fields for editing
    const strengthMatch = p.name.match(/\(([^)]+)\)$/); // Find content in last parentheses
    const baseName = p.name.replace(/\s\(([^)]+)\)$/, '') || p.name; // Remove (Strength) for p_name field
    
    $('p_name').value = baseName; // Use base name
    $('p_strength').value = strengthMatch ? strengthMatch[1] : ''; // Parse strength from p.name
    
    $('p_category').value = p.category || '';
    $('p_batch').value = p.batch_no || '';
    $('p_expiry').value = p.expiry_date || '';
    $('p_manufacturer').value = p.manufacturer || '';
    $('p_purchase').value = p.purchase_price;
    $('p_selling').value = p.selling_price;
    $('p_stock').value = p.stock_qty; // <--- STOCK FIELD VALUE IS SET HERE
    $('p_reorder_point').value = p.reorder_point || '5';
    $('p_supplier').value = p.supplier_id || '';
    $('p_location').value = p.location;
    $('p_barcode').value = p.barcode || ''; 
    
  } else {
    // Clear form for Add mode
    btn.textContent = 'Add Product';
    $('p_name').value = '';
    $('p_strength').value = '';
    $('p_category').value = '';
    $('p_batch').value = '';
    $('p_expiry').value = '';
    $('p_manufacturer').value = '';
    $('p_purchase').value = '';
    $('p_selling').value = '';
    $('p_stock').value = ''; // <--- STOCK FIELD IS CLEARED HERE
    $('p_reorder_point').value = '5';
    $('p_supplier').value = '';
    $('p_location').value = '';
    $('p_barcode').value = ''; 
  }
}

async function addProduct(){
  const baseName = $('p_name').value.trim();
  const strength = $('p_strength').value.trim();
  if(!baseName) return alert('Enter product name');
  
  // Construct the full name (Name (Strength))
  const fullName = strength ? `${baseName} (${strength})` : baseName;
  
  // --- CHECK FOR DUPLICATES ON INSERT ---
  if(!currentEditingProductId) { 
    // Check if a product with the same full name already exists in the cache
    const existing = productsCache.find(p => p.name.toLowerCase() === fullName.toLowerCase());
    if (existing) {
        return alert(`A product with the name "${fullName}" already exists (ID: ${existing.id}). Use the Edit button to update it.`);
    }
  }
  // --------------------------------------------------
  
  const p = {
    name: fullName,
    // strength: strength, // <--- REMOVED TO PREVENT SCHEMA ERROR
    category: $('p_category').value,
    batch_no: $('p_batch').value,
    expiry_date: $('p_expiry').value || null,
    manufacturer: $('p_manufacturer').value,
    purchase_price: parseFloat($('p_purchase').value || 0),
    selling_price: parseFloat($('p_selling').value || 0),
    stock_qty: parseInt($('p_stock').value || 0), // <--- STOCK QTY IS READ HERE
    reorder_point: parseInt($('p_reorder_point').value || 5),
    supplier_id: parseInt($('p_supplier').value || null),
    location: $('p_location').value,
    barcode: $('p_barcode').value.trim() || null 
  };

  let error;
  let action;

  if(currentEditingProductId){
    // UPDATE
    const { error: updateError } = await supabase.from('products').update(p).eq('id', currentEditingProductId);
    error = updateError;
    action = 'updated';
  } else {
    // INSERT
    const { error: insertError } = await supabase.from('products').insert([p]);
    error = insertError;
    action = 'added';
  }

  if(error) return alert(error.message);
  
  // Success
  alert(`Product ${action} successfully!`);
  setProductFormState(null); // Clear form and switch to Add mode
  loadProducts();
}

// Simplified editProduct to just set the form state
function editProduct(id){
  const p = productsCache.find(x=>x.id===id);
  if(!p) return alert('Product not found');
  setProductFormState(id);
}

async function deleteProduct(id){
  if(!confirm('Are you sure you want to delete this product? This action is permanent.')) return;
  const { error } = await supabase.from('products').delete().eq('id', id);
  if(error) return alert(error.message);
  loadProducts();
}

async function importProductsCSV(file){
  if (!file) return;

  try {
    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) return alert('CSV file is empty or malformed.');

    // Expected Headers (case-insensitive mapping)
    const rawHeaders = lines[0].split(',').map(h=>h.trim().toLowerCase());
    const requiredHeaders = [
        'name', 'strength', 'category', 'batch_no', 'expiry_date', 'manufacturer', 
        'purchase_price', 'selling_price', 'stock_qty', 'reorder_point', 'supplier_name', 'location', 'barcode'
    ];
    
    // Map of supplier name to ID for the import logic
    const supplierMap = suppliersCache.reduce((map, s) => {
        map[s.name.toLowerCase()] = s.id;
        return map;
    }, {});

    const productsToInsert = [];
    const productsToUpdate = [];
    let insertedCount = 0;
    let updatedCount = 0;

    // Process rows starting from the second line (index 1)
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length !== rawHeaders.length) continue; // Skip malformed rows
        
        const product = {};
        for (let j = 0; j < rawHeaders.length; j++) {
            product[rawHeaders[j]] = values[j]?.trim();
        }
        
        // Data cleaning and transformation
        product.purchase_price = parseFloat(product.purchase_price || 0);
        product.selling_price = parseFloat(product.selling_price || 0);
        product.stock_qty = parseInt(product.stock_qty || 0);
        product.reorder_point = parseInt(product.reorder_point || 5);
        
        // Find Supplier ID
        product.supplier_id = supplierMap[product.supplier_name?.toLowerCase()] || null;
        
        // Construct the full name (Name (Strength))
        const fullName = product.strength ? `${product.name} (${product.strength})` : product.name;
        product.name = fullName;
        
        // Check if product exists by name (simplified check)
        const existing = productsCache.find(p => p.name.toLowerCase() === product.name.toLowerCase());
        
        if (existing) {
            // Update existing product
            // The 'strength' and 'supplier_name' will be removed later in the bulk update loop
            delete product.strength; 
            productsToUpdate.push({ id: existing.id, ...product });
            updatedCount++;
        } else {
            // Insert new product
            delete product.strength; // Make sure not to try to insert the non-existent 'strength' column
            
            // --- BUG FIX: Remove non-column field 'supplier_name' before inserting ---
            delete product.supplier_name; 
            
            productsToInsert.push(product);
            insertedCount++;
        }
    }

    // 2. Perform bulk operations
    if (productsToInsert.length > 0) {
        const { error } = await supabase.from('products').insert(productsToInsert);
        if (error) throw new Error('Insert Error: ' + error.message);
    }
    
    // Supabase does not have a native bulk update, so we use a sequence of single updates
    for (const prod of productsToUpdate) {
        const { id, ...updateData } = prod;
        // Exclude properties that aren't columns (like supplier_name)
        delete updateData.supplier_name; 
        
        const { error } = await supabase.from('products').update(updateData).eq('id', id);
        if (error) console.warn(`Update Error for ID ${id}: ${error.message}`);
    }

    alert(`CSV Import successful!\nInserted: ${insertedCount} products\nUpdated: ${updatedCount} products`);
    loadProducts(); // Reload data after import
  } catch (error) {
    alert('An error occurred during CSV import: ' + error.message);
    console.error(error);
  }
}

/* ---------------- SALES & CART ---------------- */

function prepareSaleForm(){
  // Clear all previous data for a new sale
  cart = [];
  $('s_customer').value = '';
  // Set current date/time
  $('s_date').value = getLocalDatetimeString(new Date());
  $('s_payment').value = 'Cash'; 
  
  // Reset cart display
  renderCart();
  
  // Re-render select options
  renderSaleProductSelect(productsCache);
}

function addToCart(){
  const sel = $('saleProductSelect');
  const qtyInput = $('saleQty');
  
  if(!sel.value) return alert('Select a product');
  
  const id = parseInt(sel.value);
  const qty = parseInt(qtyInput.value || 1);
  const selectedOption = sel.options[sel.selectedIndex];
  const price = parseFloat(selectedOption.getAttribute('data-price'));
  const stock = parseInt(selectedOption.getAttribute('data-stock'));
  
  if(qty <= 0) return alert('Enter a valid quantity');
  
  const existing = cart.find(c=>c.id===id);
  let newQty = existing ? existing.qty + qty : qty;
  
  if(newQty > stock) return alert(`Cannot add ${qty} units. Only ${stock - (existing ? existing.qty : 0)} left in stock.`);
  
  if(existing){
    existing.qty = newQty;
  } else {
    const product = productsCache.find(p=>p.id===id);
    cart.push({
      id, 
      name: product.name, 
      price, 
      qty, 
      purchase_price: product.purchase_price
    });
  }
  
  // Clear the search/selection and reset qty
  $('searchSaleProduct').value = '';
  $('saleQty').value = '1';
  renderSaleProductSelect(productsCache); // Re-render to update stock info in select
  renderCart();
}

function renderCart(){
  const tbody = $('cartTable').querySelector('tbody');
  tbody.innerHTML = cart.map((i, idx)=>`
    <tr>
      <td>${i.name.replace(/\s\([^)]+\)$/,'')}</td>
      <td class="right">
        <input type="number" value="${i.qty}" min="1" onchange="updateCartQty(${idx}, this.value)" style="width:60px;padding:.3rem">
      </td>
      <td class="right">Rs. ${fmt(i.price)}</td>
      <td class="right">Rs. ${fmt(i.price * i.qty)}</td>
      <td><button onclick="removeCartItem(${idx})"><i class="fa-solid fa-trash"></i></button></td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="muted">Cart is empty</td></tr>';
  
  const total = cart.reduce((s,i)=>s + i.price * i.qty, 0);
  
  // NEW: Use a dedicated footer div for total (to apply better CSS)
  const cartFooter = $('cartFooter');
  if(cartFooter) {
      cartFooter.innerHTML = `<span>Total:</span> <span id="cartTotal">Rs. ${fmt(total)}</span>`;
  }
}

function updateCartQty(idx, val){
  const v = parseInt(val||0);
  const item = cart[idx];
  
  if(v<=0) return removeCartItem(idx); // Remove if qty is zero or less
  
  const productInCache = productsCache.find(p => p.id === item.id);

  if (productInCache && v > productInCache.stock_qty) {
      alert(`Cannot set quantity to ${v}. Only ${productInCache.stock_qty} left in stock.`);
      // Reset value to old quantity (need to re-render or set manually)
      renderCart(); 
      return;
  }
  
  item.qty = v;
  renderCart();
  // Re-render select options to update stock display (optional, but good practice)
  renderSaleProductSelect(productsCache);
}

function removeCartItem(idx){
  cart.splice(idx, 1);
  renderCart();
  // Re-render select options to update stock display
  renderSaleProductSelect(productsCache);
}

async function checkout(){
  if(cart.length === 0) return alert('Cart is empty!');
  
  const total = cart.reduce((s,i)=>s + i.price * i.qty, 0);
  const saleDate = $('s_date').value || getLocalDatetimeString(new Date()); // Use form date or current datetime
  const customerName = $('s_customer').value.trim() || 'Walk-in Customer';
  const paymentMethod = $('s_payment').value;
  
  // 1. Insert into Sales table
  const saleData = {
    customer_name: customerName,
    total: total,
    sale_date: saleDate,
    payment_method: paymentMethod
  };
  
  const { data: sale, error: saleErr } = await supabase.from('sales').insert([saleData]).select().single();
  
  if(saleErr) return alert('Sale Error: ' + saleErr.message);

  const saleId = sale.id;
  const itemsForInvoice = [];

  // 2. Insert into Sale Items and update stock
  for(const item of cart){
    // Collect data for invoice/reporting
    itemsForInvoice.push({
        id: item.id,
        name: item.name,
        qty: item.qty,
        price: item.price
    });

    const { error: itErr } = await supabase.from('sale_items').insert([{
      sale_id: saleId,
      product_id: item.id,
      quantity: item.qty,
      price: item.price,
      subtotal: item.price * item.qty
    }]);

    if(itErr) console.warn('Sale Item Insert Error:', itErr.message);
    
    // Decrease stock
    const { error: decreaseErr } = await supabase.rpc('decrease_stock', { pid: item.id, qty: item.qty });
    if(decreaseErr) console.error('Stock Update Error:', decreaseErr.message);
  }
  
  alert(`Sale recorded! ID: ${saleId}`);
  
  // Clear cart and form
  cart = [];
  $('s_customer').value = '';
  prepareSaleForm();
  
  // Reload relevant data
  loadProducts(); // To update stock levels
  loadDashboard(); // To update metrics
  loadSalesHistory(); // To show new sale
  
  // Show invoice
  showInvoice(saleData, itemsForInvoice);
}

function showInvoice(data, items){
  // Format date for display
  const displayDate = new Date(data.sale_date).toLocaleString();
  const total = data.total;
  const customer = data.customer_name;
  const payment = data.payment_method;
  
  const html = `
    <div style="font-family:'Segoe UI', sans-serif; padding:10px; border:1px solid #333; margin-bottom:.5rem;">
      <h3 style="text-align:center;margin:0">Medical Store POS</h3>
      <div style="font-size:.8rem;text-align:center;margin-bottom:.5rem">Sale ID: ${data.id}</div>
      <div>Customer: ${customer}</div>
      <div>Date/Time: ${displayDate}</div>
      <div>Payment: ${payment}</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th>Product</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead>
        <tbody>
          ${items.map(i=>`
            <tr>
              <td>${i.name.replace(/\s\([^)]+\)$/,'')}</td>
              <td class="right">${i.qty}</td>
              <td class="right">Rs. ${fmt(i.price)}</td>
              <td class="right">Rs. ${fmt(i.qty*i.price)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div style="text-align:right;font-weight:bold;margin-top:.5rem">Total: Rs. ${fmt(total)}</div>
    </div>`;
    
  $('invoiceContent').innerHTML = html;
  $('invoice-modal').style.display = 'block';
}

function closeInvoice(){
  $('invoice-modal').style.display = 'none';
}

function printInvoice(){
  window.print();
}

/* ---------------- REFUNDS ---------------- */

async function loadRefunds(){
  if(!$('refundsTable')) return;

  // Load products into refund select
  const sel = $('refundProductSelect');
  sel.innerHTML = productsCache.map(p=>
    `<option value="${p.id}" data-name="${p.name}">
      ${p.name}
    </option>`
  ).join('') || '<option value="">No products available</option>';

  // Load history from the refunds table
  // FIX APPLIED: 'created_at' is now included in the select query.
  const { data, error } = await supabase.from('refunds').select('id, product_id, quantity, reason, created_at, products(name)').order('id', { ascending: false });
  if(error) return console.warn("loadRefunds Error:", error.message || error);
  
  const tbody = $('refundsTable').querySelector('tbody');
  tbody.innerHTML = (data || []).map(r=>{
      // FIX APPLIED: Use the actual created_at value from the database
      const displayDate = r.created_at ? new Date(r.created_at).toLocaleDateString() : 'N/A';
      return `
      <tr>
        <td>${r.products?.name||'Unknown'}</td>
        <td class="right">${r.quantity}</td>
        <td>${r.reason}</td>
        <td>${displayDate}</td> 
      </tr>`;
  }).join('') || '<tr><td colspan="4">No refund history found.</td></tr>';
}

async function processRefund(){
  const sel = $('refundProductSelect');
  const qtyInput = $('refundQty');
  const reasonInput = $('refundReason');
  
  if(!sel.value) return alert('Select a product for refund');
  const productId = parseInt(sel.value);
  const qty = parseInt(qtyInput.value || 0);
  const reason = reasonInput.value.trim();
  
  if(qty <= 0) return alert('Enter a valid quantity');
  if(!reason) return alert('Enter a reason for refund');
  
  // 1. Insert into Refunds table
  // The 'created_at' column will be automatically set by the database using the 'now()' default value.
  const { error: refundErr } = await supabase.from('refunds').insert([{
    product_id: productId,
    quantity: qty,
    reason: reason,
  }]);
  
  if(refundErr) return alert('Refund Error: ' + refundErr.message);

  // 2. Increase stock (Reverse of sales)
  const { error: increaseErr } = await supabase.rpc('increase_stock', { pid: productId, qty: qty });
  if(increaseErr) console.error('Stock Update Error:', increaseErr.message);
  
  alert(`Refund of ${qty} units processed successfully!`);
  
  // Clear form and reload data
  qtyInput.value = '';
  reasonInput.value = '';
  loadProducts(); // To update stock levels
  loadRefunds(); // To update refund history
  loadDashboard(); // To update metrics
}

/* ---------------- HISTORY ---------------- */

async function loadSalesHistory(){
  if(!$('salesHistoryTable')) return;
  
  const from = $('historyFrom').value || null;
  const to = $('historyTo').value || null;
  const searchTerm = $('historySearch').value.toLowerCase().trim();
  const paymentMethod = $('historyPaymentFilter').value || null;

  let query = supabase.from('sales').select('*').order('sale_date',{ascending:false});
  
  if (from) {
    query = query.gte('sale_date', getStartOfDay(new Date(from))); // Use helper for date range
  }
  if (to) {
    query = query.lte('sale_date', getEndOfDay(new Date(to))); // Use helper for date range
  }
  if (paymentMethod) {
    query = query.eq('payment_method', paymentMethod);
  }

  const { data, error } = await query;
  if(error) return console.warn("loadSalesHistory Error:", error.message || error);
  
  // Client-side filter for Search Term (ID or Customer Name)
  const filteredData = (data || []).filter(s => {
    if (!searchTerm) return true;
    const idMatch = String(s.id).includes(searchTerm);
    const customerMatch = (s.customer_name || '').toLowerCase().includes(searchTerm);
    return idMatch || customerMatch;
  });

  const tbody = $('salesHistoryTable').querySelector('tbody');
  tbody.innerHTML = (filteredData||[]).map(s=>`
    <tr>
      <td>${s.id}</td>
      <td>${new Date(s.sale_date).toLocaleString()}</td>
      <td>${s.customer_name||'Walk-in'}</td>
      <td class="right">Rs. ${fmt(s.total)}</td>
      <td>${s.payment_method}</td>
      <td><button class="small" onclick="viewSaleDetails(${s.id})">View</button></td>
    </tr>
  `).join('') || '<tr><td colspan="6">No sales history found.</td></tr>';
}

// app.js (around line 527)

async function viewSaleDetails(id){
    const { data } = await supabase.from('sales').select('*').eq('id', id).single();
    const { data: items } = await supabase.from('sale_items').select('*, products(name)').eq('sale_id', id);
    
    if(data) {
        // Recreate the structure required for showInvoice (to make it reusable)
        const saleData = {
            id: data.id,
            sale_date: data.sale_date,
            // FIX: Add a fallback ('||') to prevent 'undefined' if data is null/missing in the database
            customer_name: data.customer_name || 'Walk-in Customer', 
            payment_method: data.payment_method || 'Cash', // Default to 'Cash' if missing
            total: data.total
        };
        
        const itemsForInvoice = (items || []).map(i => ({
            name: i.products ? i.products.name : 'Unknown Product',
            qty: i.quantity,
            price: i.price
        }));

        showInvoice(saleData, itemsForInvoice); // Call the reusable invoice function
    } else {
        alert('Sale details not found!');
    }
}


// UPDATED FUNCTION: Now includes fetching, calculating, and displaying Gross Profit
async function generateReport(){
  if(!$('reportResult')) return;
  
  const from = $('reportFrom').value || null;
  const to = $('reportTo').value || null;
  
  // Query sale_items, sales (for date), and products (for purchase price)
  let q = supabase.from('sale_items').select('product_id,quantity,price, sales(sale_date), products(name, purchase_price)');
  
  // Conditional filtering by date range
  if (from) {
    q = q.gte('sales.sale_date', getStartOfDay(new Date(from)));
  }
  if (to) {
    q = q.lte('sales.sale_date', getEndOfDay(new Date(to)));
  }

  const { data, error } = await q;
  if(error) return console.error("Report Error:", error.message || error);

  // Aggregation logic
  const aggregatedData = {};
  let overallRevenue = 0;
  let overallCost = 0;

  (data || []).forEach(item => {
    // Only process items that have product data
    if (item.products) {
      const productId = item.product_id;
      const productName = item.products.name;
      const purchasePrice = parseFloat(item.products.purchase_price || 0);
      const revenue = item.quantity * item.price;
      const cost = item.quantity * purchasePrice;
      const profit = revenue - cost;
      
      overallRevenue += revenue;
      overallCost += cost;

      if (!aggregatedData[productId]) {
        aggregatedData[productId] = {
          name: productName,
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0
        };
      }

      aggregatedData[productId].qty += item.quantity;
      aggregatedData[productId].revenue += revenue;
      aggregatedData[productId].cost += cost;
      aggregatedData[productId].profit += profit;
    }
  });

  const overallProfit = overallRevenue - overallCost;
  const reportItems = Object.values(aggregatedData).sort((a,b)=>b.revenue - a.revenue); // Sort by revenue

  const html = `
    <p>Report Period: <b>${from || 'All Time'}</b> to <b>${to || 'Current'}</b></p>
    <p>Total Revenue: <b>Rs. ${fmt(overallRevenue)}</b> | Total Cost: <b>Rs. ${fmt(overallCost)}</b> | Gross Profit: <b style="color:#10b981">Rs. ${fmt(overallProfit)}</b></p>
    <table style="margin-top:1rem">
      <thead><tr><th>Product Name</th><th class="right">Qty Sold</th><th class="right">Revenue Rs.</th><th class="right">Cost Rs.</th><th class="right">Gross Profit Rs.</th></tr></thead>
      <tbody>
        ${reportItems.map(r=>`
          <tr>
            <td>${r.name}</td>
            <td class="right">${r.qty}</td>
            <td class="right">Rs. ${fmt(r.revenue)}</td>
            <td class="right">Rs. ${fmt(r.cost)}</td>
            <td class="right">Rs. ${fmt(r.profit)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
  $('reportResult').innerHTML = html;
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportSalesCSV(){
  (async () => {
    const from = $('historyFrom').value || null;
    const to = $('historyTo').value || null;
    const searchTerm = $('historySearch').value.toLowerCase().trim();
    const paymentMethod = $('historyPaymentFilter').value || null;
    
    // Use a slightly modified loadSalesHistory logic to get the raw data
    let query = supabase.from('sales').select('*').order('sale_date',{ascending:false});
    
    if (from) {
      query = query.gte('sale_date', getStartOfDay(new Date(from)));
    }
    if (to) {
      query = query.lte('sale_date', getEndOfDay(new Date(to)));
    }
    if (paymentMethod) {
      query = query.eq('payment_method', paymentMethod);
    }

    const { data } = await query;
    
    // Client-side filter for Search Term (ID or Customer Name) (REFACTORED)
    const filteredData = (data || []).filter(s => {
      if (!searchTerm) return true;
      const idMatch = String(s.id).includes(searchTerm);
      const customerMatch = (s.customer_name || '').toLowerCase().includes(searchTerm);
      return idMatch || customerMatch;
    });

    if(!filteredData || !filteredData.length) return alert('No sales to export');

    // Include all columns in CSV. Convert sale_date to full local string.
    const csvHeader = ["Sale ID", "Date/Time", "Customer Name", "Total", "Payment Method", "Created At"].join(",");
    const csvRows = filteredData.map(s => {
        return [
            s.id,
            new Date(s.sale_date).toLocaleString(),
            `"${s.customer_name || 'Walk-in'}"`, // Quotes around customer name
            fmt(s.total),
            s.payment_method,
            new Date(s.created_at).toLocaleString()
        ].join(",");
    });

    downloadCSV([csvHeader].concat(csvRows).join("\n"), "sales_history.csv");
  })();
}

function exportReportCSV(){
  alert('Report CSV export is not yet implemented.');
  // The logic would be similar to generateReport(), but outputting to a CSV format.
}

/* ---------------- DASHBOARD METRICS ---------------- */

async function loadDashboard(){
  const scope = $('dashboardScope').value;
  const now = new Date();
  let startDate;
  let endDate;

  // Determine date range based on scope
  if (scope === '1') { // Today
      startDate = getStartOfDay(now);
      endDate = getEndOfDay(now);
  } else if (scope === '7') { // Last 7 Days
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(now.getDate() - 6);
      startDate = getStartOfDay(sevenDaysAgo);
      endDate = getEndOfDay(now);
  } else if (scope === '30') { // Last 30 Days
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 29);
      startDate = getStartOfDay(thirtyDaysAgo);
      endDate = getEndOfDay(now);
  } else { // All Time ('all')
      startDate = getStartOfDay(new Date(0)); // Epoch start
      endDate = getEndOfDay(now);
  }

  // 1. Fetch all relevant sales data (sale_items, sales, products)
  let query = supabase.from('sale_items').select('*, sales(id, customer_name, sale_date), products(name, purchase_price, stock_qty, reorder_point)');
  
  // Apply the calculated date range to the query (using GTE and LTE on the sale_date)
  query = query.gte('sales.sale_date', startDate).lte('sales.sale_date', endDate);
  
  const { data: itemsData, error: itemsError } = await query;
  if(itemsError) return console.warn("loadDashboard Sales Error:", itemsError.message || itemsError);

  // 2. Aggregation Metrics
  let totalRevenue = 0;
  let totalCost = 0;
  const uniqueSaleIds = new Set();
  const topSellingMap = {};
  const stats = {}; // For reorder calculation (total qty sold in the period)
  
  // Calculate total revenue, cost, and gross profit
  (itemsData || []).forEach(item => {
    // FIX: Only process items that belong to a sale within the filter date
    if (item.sales?.id) {
      const revenue = item.quantity * item.price;
      // Purchase Price Ø¹Ø³Ú©Ø¹Ù…Ø§Ù„ Ú©Ø±ØªÛ’ Û ÙˆØ¦Û’ Cost Ú©Ø§ Ø­Ø³Ø§Ø¨ Ù„Ú¯Ø§ÛŒØ§ Ú¯ÛŒØ§
      const cost = item.quantity * parseFloat(item.products?.purchase_price || 0);
      
      totalRevenue += revenue;
      totalCost += cost;
      uniqueSaleIds.add(item.sales.id);
      
      // Reorder Calculation
      stats[item.product_id] = (stats[item.product_id] || 0) + (item.quantity || 0);

      // Top Selling Calculation
      const name = item.products?.name || `ID ${item.product_id}`;
      if(!topSellingMap[item.product_id]) topSellingMap[item.product_id] = { name, qty: 0, revenue: 0 };
      
      topSellingMap[item.product_id].qty += item.quantity;
      topSellingMap[item.product_id].revenue += revenue; 
    }
  });

  const totalGrossProfit = totalRevenue - totalCost;

  // 3. Update Metric Display
  if($('metricSales')) $('metricSales').textContent = uniqueSaleIds.size;
  if($('metricRevenue')) $('metricRevenue').textContent = `Rs. ${fmt(totalRevenue)}`;
  if($('metricProfit')) $('metricProfit').textContent = `Rs. ${fmt(totalGrossProfit)}`;

  // 4. Low Stock & Expiring Table
  let lowStockCount = 0;
  const lowStockProducts = [];
  const expiringProducts = [];

  // Use the productsCache (all products) for stock/expiry checks
  productsCache.forEach(p => {
      const reorderPoint = p.reorder_point || 5;
      if (p.stock_qty < reorderPoint) {
          lowStockCount++;
          lowStockProducts.push(p);
      }
      
      // Expiring logic (within 90 days or expired)
      if (p.expiry_date) {
          const expiry = new Date(p.expiry_date);
          const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
          if (diffDays <= 90) {
              expiringProducts.push(p);
          }
      }
  });

  if($('metricLowStock')) $('metricLowStock').textContent = lowStockCount;
  
  // Render Low Stock Table
  if($('lowStockTable')) $('lowStockTable').querySelector('tbody').innerHTML = lowStockProducts.length ? lowStockProducts.map(p=>`
    <tr>
      <td>${p.name}</td>
      <td class="right danger">${p.stock_qty}</td>
      <td>${p.supplier_name || 'N/A'}</td>
    </tr>
  `).join('') : '<tr><td colspan="3">No low stock items</td></tr>';

  // Render Expiring Table (sorted by date)
  const expiringSorted = expiringProducts.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
  if($('expiringTable')) $('expiringTable').querySelector('tbody').innerHTML = expiringSorted.length ? expiringSorted.map(p=>{
      const expiry = new Date(p.expiry_date);
      const days = Math.ceil((expiry - now) / (1000*60*60*24));
      const color = days < 0 ? 'red' : (days <= 7 ? 'orange' : '');
      return `
      <tr>
        <td>${p.name}</td>
        <td>${p.expiry_date}</td>
        <td class="right" style="color:${color}">${days}</td>
      </tr>`;
  }).join('') : `<tr><td colspan="3">No products expiring soon</td></tr>`;

  // 5. Top Selling Table
  const topSellers = Object.values(topSellingMap).sort((a,b)=>b.revenue - a.revenue).slice(0, 5);
  if($('topSellingTable')) $('topSellingTable').querySelector('tbody').innerHTML = topSellers.length ? topSellers.map(s=>
      `<tr>
        <td>${s.name}</td>
        <td class="right">${s.qty}</td>
        <td class="right">Rs. ${fmt(s.revenue)}</td>
      </tr>`
  ).join('') : `<tr><td colspan="3">No sales in this period</td></tr>`;

  // 6. Reorder Table (Reorder Point > Stock Qty AND Sold Qty > 0)
  const reorderList = productsCache
    .filter(p => p.stock_qty < (p.reorder_point || 5) && stats[p.id] > 0) // Low stock AND sales activity
    .map(p => {
        // Calculate daily average sales in the period
        const periodDays = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) || 1;
        const avgDailySale = (stats[p.id] || 0) / periodDays;
        
        // Suggest a reorder quantity (e.g., 30 days of sales + reorder point buffer)
        const reorderQty = Math.ceil((avgDailySale * 30) + (p.reorder_point || 5));
        
        return {
            name: p.name,
            stock: p.stock_qty,
            avgDaily: avgDailySale,
            reorderQty: reorderQty
        };
    })
    .sort((a,b)=>b.reorderQty - a.reorderQty); // Sort by highest suggested reorder quantity

  if($('reorderTable')) $('reorderTable').querySelector('tbody').innerHTML = reorderList.length ? reorderList.map(r=>
      `<tr>
        <td>${r.name}</td>
        <td class="right">${r.stock}</td>
        <td class="right">${fmt(r.avgDaily)}</td>
        <td class="right success">${r.reorderQty}</td>
      </tr>`
  ).join('') : `<tr><td colspan="4">No reorder suggestions based on current stock/sales.</td></tr>`;
}

function generatePurchaseCSV(){
    // This function has been modified to show the list of required restock items 
    // in a single pop-up (alert) as requested by the user.
    
    const scope = $('dashboardScope').value;
    const now = new Date();
    let startDate;
    let endDate;

    // Determine date range 
    if (scope === '1') {
        startDate = getStartOfDay(now);
        endDate = getEndOfDay(now);
    } else if (scope === '7') {
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 6);
        startDate = getStartOfDay(sevenDaysAgo);
        endDate = getEndOfDay(now);
    } else if (scope === '30') {
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(now.getDate() - 29);
        startDate = getStartOfDay(thirtyDaysAgo);
        endDate = getEndOfDay(now);
    } else {
        startDate = getStartOfDay(new Date(0));
        endDate = getEndOfDay(now);
    }
    
    // Fetch all sales data for the period (required for stats calculation)
    (async () => {
        let query = supabase.from('sale_items').select('product_id,quantity, sales(sale_date)');
        query = query.gte('sales.sale_date', startDate).lte('sales.sale_date', endDate);
        const { data: itemsData } = await query;
        
        const stats = {}; // total qty sold in the period
        (itemsData || []).forEach(item => {
            if (item.sales?.sale_date) {
                stats[item.product_id] = (stats[item.product_id] || 0) + (item.quantity || 0);
            }
        });

        // Generate Reorder List
        const reorderList = productsCache
            .filter(p => p.stock_qty < (p.reorder_point || 5) && stats[p.id] > 0) 
            .map(p => {
                const periodDays = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) || 1;
                const avgDailySale = (stats[p.id] || 0) / periodDays;
                // Suggest a reorder quantity (30 days of sales + reorder point buffer)
                const reorderQty = Math.ceil((avgDailySale * 30) + (p.reorder_point || 5));
                
                return {
                    name: p.name,
                    currentStock: p.stock_qty,
                    reorderPoint: p.reorder_point || 5, // CSV ke liye
                    suggestedOrderQty: reorderQty,
                    supplier: p.supplier_name || 'N/A'
                };
            })
            .sort((a,b)=>b.suggestedOrderQty - a.suggestedOrderQty); // Sort by highest suggested reorder quantity

        if(reorderList.length === 0) return alert('Restock ke liye koi item suggest nahi hua hai. (No items suggested for restock).');
        
        // Generate formatted text content for a single popup
        let output = `*** REQUIRED RESTOCK ITEMS (PURCHASE ORDER) ***\n\n`;
        output += `Daikhiye, yahi woh items hain jo order karne ki zaroorat hai. (Period: ${startDate.substring(0, 10)} - ${endDate.substring(0, 10)})\n\n`;
        output += `Item\t\t\t\tOrder Qty\tCurrent Stock\tSupplier\n`;
        output += `----------------------------------------------------------------------------------------------------\n`;
        
        reorderList.forEach(r => {
            // Limited formatting for alert box
            const name = r.name.substring(0, 25).padEnd(25, ' ');
            const qty = String(r.suggestedOrderQty).padEnd(10, ' ');
            const stock = String(r.currentStock).padEnd(14, ' ');
            const supplier = r.supplier.substring(0, 15);
            
            output += `${name}\t${qty}\t${stock}\t${supplier}\n`;
        });
        
        output += `\n----------------------------------------------------------------------------------------------------\n`;
        output += `In sabhi items ko purchase order mein shamil karne ke liye is list ko copy kar lein.`;
        
        // Show the formatted list in a single prompt/popup
        alert(output);
        
        // Provide the option to download the CSV for better tracking (optional, but helpful)
        if(confirm('Aap ne list pop-up mein dekh li hai. Kya aap is list ko CSV file mein download bhi karna chahenge? (Do you also want to download this list as a CSV file?)')) {
            const csvHeader = ["Product Name", "Current Stock", "Reorder Point", "Suggested Order Qty", "Supplier"].join(",");
            // Use reorderPoint from the generated list for the CSV export
            const csvRows = reorderList.map(r => `"${r.name.replace(/"/g, '""')}",${r.currentStock},${r.reorderPoint},${r.suggestedOrderQty},"${r.supplier}"`).join("\n");
            downloadCSV([csvHeader, csvRows].join("\n"), "purchase_order_reorder_list.csv");
            alert('CSV file download ho chuki hai.');
        }

    })();
}

function generatePurchasePDF(){
    alert('Purchase PDF generation is not yet implemented.');
}

/* ---------------- BOOTSTRAP on load ---------------- */
async function init(){
  
  // Set default dates
  const now = new Date();
  const todayDate = now.toISOString().slice(0,10); // Date-only format
  
  // Set default for date-only inputs
  ['historyFrom','historyTo','reportFrom','reportTo'].forEach(id=>{ 
      if($(id)) $(id).value = todayDate; 
  });
  
  // UPDATED: Set default for datetime-local input (s_date)
  if($('s_date')) $('s_date').value = getLocalDatetimeString(now);
  
  // Load all initial data needed by the app
  await loadSuppliers(); 
  await loadProducts(); 
  
  // Load dashboard and history AFTER initial data is ready
  await loadDashboard();
  loadRefunds(); 
  loadSalesHistory();
  
  $('projectStatus').textContent = 'Ready';
  
  // Apply initial access and set UI
  checkAccessControls(); 
}

/* FIXED: Attaching the event listener AFTER the whole DOM and script are loaded */
window.onload = function() {
  const loginButton = $('loginBtn');
  if (loginButton) {
    loginButton.addEventListener('click', handleLogin);
  }
  
  // Allow pressing Enter key to login
  const loginPassInput = $('loginPass');
  if (loginPassInput) {
    loginPassInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        handleLogin();
      }
    });
  }
};
