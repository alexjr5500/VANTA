import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET;

if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables');
}

export const generateToken = (payload: object) => {
    return jwt.sign(payload, secret, {
        expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'],
    });
};