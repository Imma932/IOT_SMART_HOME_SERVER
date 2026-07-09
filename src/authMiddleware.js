import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export function authenticateToken(request, response, next) {
    const authHeader = request.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return response.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (error, decoded) => {
        if (error) {
            return response.status(403).json({ error: 'Invalid or expired token' });
        }
        request.userId = decoded.userId;
        next();
    });
}

export function generateToken(userId) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}
