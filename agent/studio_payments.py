"""Fail-closed Google Pay integration boundary; no payment processing is enabled."""
from fastapi import APIRouter, HTTPException, Request


def create_router():
    router = APIRouter(prefix='/payments')

    @router.get('/options')
    def options():
        return {'method': 'google_pay', 'available': False,
                'plans': [{'id': 'monthly', 'amount': None, 'currency': None},
                          {'id': 'yearly', 'amount': None, 'currency': None}]}

    @router.post('/checkout')
    def checkout(request: Request):
        from .studio_identity import request_identity
        identity = request_identity(request)
        if not identity or not identity.get('user'):
            raise HTTPException(401, '请先登录后购买会员。')
        # Never accept prices or payment success from the browser. A real provider,
        # verified server callbacks and transactional orders must be added first.
        raise HTTPException(503, 'Google Pay 支付暂未开通。')

    return router
