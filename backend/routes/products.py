"""Test & package catalogue - the product search surface."""

from flask import Blueprint, request

from ..auth import ApiError, audit, body, perm_required, ok, paginated
from ..models import PackageItem, Product, db

bp = Blueprint("products", __name__, url_prefix="/api/products")


def _query():
    q = Product.query
    search = (request.args.get("q") or "").strip()
    if search:
        like = f"%{search}%"
        q = q.filter(
            Product.name.ilike(like)
            | Product.code.ilike(like)
            | Product.category.ilike(like)
        )
    category = request.args.get("category")
    if category:
        q = q.filter(Product.category == category)
    kind = request.args.get("kind")
    if kind:
        q = q.filter(Product.kind == kind)
    if request.args.get("active") == "0":
        q = q.filter(Product.active.is_(False))
    elif request.args.get("active") != "all":
        q = q.filter(Product.active.is_(True))

    sort = request.args.get("sort", "name")
    direction = {
        "name": Product.name,
        "price": Product.price,
        "category": Product.category,
        "tat": Product.tat_hours,
    }.get(sort, Product.name)
    if request.args.get("dir") == "desc":
        direction = direction.desc()
    return q.order_by(direction)


@bp.get("")
@perm_required("products.view")
def list_products():
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, int(request.args.get("per_page", 20)))
    q = _query()
    total = q.count()
    products = q.offset((page - 1) * per_page).limit(per_page).all()
    return paginated([p.to_dict() for p in products], page, per_page, total)


@bp.get("/search")
@perm_required("products.view")
def search_products():
    """Fast type-ahead used by the booking wizard and global search."""
    search = (request.args.get("q") or "").strip()
    limit = min(25, int(request.args.get("limit", 12)))
    if len(search) < 2:
        return ok([])
    like = f"%{search}%"
    products = (
        Product.query.filter(
            Product.active.is_(True),
            Product.name.ilike(like)
            | Product.code.ilike(like)
            | Product.category.ilike(like),
        )
        .order_by(Product.name)
        .limit(limit)
        .all()
    )
    return ok([p.to_dict() for p in products])


@bp.get("/categories")
@perm_required("products.view")
def categories():
    rows = (
        db.session.query(Product.category, db.func.count(Product.id))
        .filter(Product.active.is_(True))
        .group_by(Product.category)
        .order_by(Product.category)
        .all()
    )
    return ok([{"name": name, "count": count} for name, count in rows])


def _fetch(product_id):
    product = db.session.get(Product, product_id)
    if product is None:
        raise ApiError("Test not found.", 404)
    return product


@bp.get("/<int:product_id>")
@perm_required("products.view")
def get_product(product_id):
    return ok(_fetch(product_id).to_dict())


@bp.post("")
@perm_required("products.edit")
def create_product():
    data = body()
    name = (data.get("name") or "").strip()
    code = (data.get("code") or "").strip().upper()
    if not name:
        raise ApiError("Test name is required.", 422, field="name")
    if not code:
        raise ApiError("Test code is required.", 422, field="code")
    if Product.query.filter_by(code=code).first():
        raise ApiError("That test code already exists.", 409, field="code")

    product = Product(code=code, name=name)
    _apply(product, data)
    if product.kind not in ("test", "package", "addon"):
        raise ApiError("Kind must be test, package or addon.", 422)

    db.session.add(product)
    db.session.flush()
    _sync_components(product, data.get("component_ids") or [])
    db.session.commit()

    audit("product_created", "product", product.id, {"code": product.code})
    return ok(product.to_dict(), message=f"{product.name} added to catalogue.", status=201)


@bp.put("/<int:product_id>")
@perm_required("products.edit")
def update_product(product_id):
    product = _fetch(product_id)
    data = body()
    if data.get("code") and data["code"].strip().upper() != product.code:
        code = data["code"].strip().upper()
        if Product.query.filter(Product.code == code, Product.id != product.id).first():
            raise ApiError("That test code already exists.", 409, field="code")
        product.code = code
    _apply(product, data)
    if data.get("component_ids") is not None:
        _sync_components(product, data["component_ids"])
    db.session.commit()
    audit("product_updated", "product", product.id, {"code": product.code})
    return ok(product.to_dict(), message="Catalogue entry updated.")


@bp.post("/<int:product_id>/toggle")
@perm_required("products.edit")
def toggle_product(product_id):
    product = _fetch(product_id)
    product.active = not product.active
    db.session.commit()
    audit("product_toggled", "product", product.id,
          {"code": product.code, "active": product.active})
    return ok(product.to_dict(),
              message=f"{product.name} is now {'active' if product.active else 'inactive'}.")


def _apply(product, data):
    if data.get("name"):
        product.name = data["name"].strip()
    if data.get("category"):
        product.category = data["category"].strip()
    if data.get("kind"):
        product.kind = data["kind"]
    if data.get("price") is not None:
        try:
            product.price = max(0.0, float(data["price"]))
        except (TypeError, ValueError):
            raise ApiError("Price must be a number.", 422, field="price")
    if data.get("cost") is not None:
        try:
            product.cost = max(0.0, float(data["cost"]))
        except (TypeError, ValueError):
            raise ApiError("Cost must be a number.", 422)
    if data.get("sample_type") is not None:
        product.sample_type = data["sample_type"]
    if data.get("tat_hours") is not None:
        try:
            product.tat_hours = max(1, int(data["tat_hours"]))
        except (TypeError, ValueError):
            raise ApiError("TAT must be an integer (hours).", 422)
    if data.get("prep_instructions") is not None:
        product.prep_instructions = data["prep_instructions"]
    if data.get("description") is not None:
        product.description = data["description"]
    if data.get("active") is not None:
        product.active = bool(data["active"])


def _sync_components(product, component_ids):
    PackageItem.query.filter_by(package_id=product.id).delete(synchronize_session=False)
    valid = Product.query.filter(
        Product.id.in_([int(i) for i in component_ids if str(i).isdigit()]),
        Product.id != product.id,
    ).all()
    for target in valid:
        db.session.add(PackageItem(package_id=product.id, test_id=target.id))
