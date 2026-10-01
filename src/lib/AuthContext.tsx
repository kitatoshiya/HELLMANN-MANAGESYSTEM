import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth } from './firebase';
import { Operator, User } from '../types';
import {
  fetchOperatorByEmail,
  saveOperatorMaster,
  seedInitialOperatorsIfNeeded,
  DEFAULT_OPERATORS,
} from './operatorService';
import { setCurrentUser } from './storageManager';

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  currentOperator: Operator | null;
  currentUser: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (data: { email: string; pass: string; name: string; employeeNumber?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshOperator: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [currentOperator, setCurrentOperator] = useState<Operator | null>(null);
  const [currentUser, setCurrentUserObj] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOperatorDetails = async (email: string, fbUser?: FirebaseUser | null): Promise<Operator> => {
    let op = await fetchOperatorByEmail(email);
    if (!op) {
      // Auto-create operator if not found
      const defaultName = fbUser?.displayName || email.split('@')[0] || '担当者';
      op = {
        id: email.toLowerCase(),
        email: email.toLowerCase(),
        name: defaultName,
        employeeNumber: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
        department: '輸出進捗管理部',
        createdAt: new Date().toISOString(),
      };
      await saveOperatorMaster(op);
    }
    return op;
  };

  useEffect(() => {
    // Seed initial demo operators to Firestore
    seedInitialOperatorsIfNeeded().catch((err) => console.warn('Seed operators warn:', err));

    let isMounted = true;

    // Safety timeout in case Firebase auth check stalls
    const safetyTimeout = setTimeout(() => {
      if (isMounted) {
        setLoading(false);
      }
    }, 1000);

    const unsubscribe = onAuthStateChanged(
      auth,
      (fbUser) => {
        clearTimeout(safetyTimeout);
        if (!isMounted) return;

        setFirebaseUser(fbUser);
        setLoading(false);

        if (fbUser && fbUser.email) {
          // Immediately set initial user info from fbUser to prevent any UI delay
          const initialUser: User = {
            uid: fbUser.uid,
            email: fbUser.email,
            displayName: fbUser.displayName || fbUser.email.split('@')[0],
            employeeNumber: '-',
            avatarColor: 'bg-blue-600',
          };
          setCurrentUserObj(initialUser);
          setCurrentUser(initialUser);

          // Fetch operator details asynchronously with timeout
          loadOperatorDetails(fbUser.email, fbUser)
            .then((op) => {
              if (isMounted) {
                setCurrentOperator(op);
                const mappedUser: User = {
                  uid: fbUser.uid,
                  email: fbUser.email,
                  displayName: op.name,
                  employeeNumber: op.employeeNumber,
                  department: op.department,
                  avatarColor: 'bg-blue-600',
                };
                setCurrentUserObj(mappedUser);
                setCurrentUser(mappedUser);
              }
            })
            .catch((err) => {
              console.warn('Operator details load deferred:', err);
            });
        } else {
          setCurrentOperator(null);
          setCurrentUserObj(null);
        }
      },
      (error) => {
        console.error('Auth state listener error:', error);
        clearTimeout(safetyTimeout);
        if (isMounted) {
          setLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      unsubscribe();
    };
  }, []);

  const login = async (email: string, pass: string) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
    if (cred.user && cred.user.email) {
      const op = await loadOperatorDetails(cred.user.email, cred.user);
      setCurrentOperator(op);
    }
  };

  const register = async (data: {
    email: string;
    pass: string;
    name: string;
    employeeNumber?: string;
  }) => {
    const cleanEmail = data.email.trim().toLowerCase();
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, data.pass);
    
    const empNum = data.employeeNumber?.trim() || `EMP-${Math.floor(1000 + Math.random() * 9000)}`;
    const newOperator: Operator = {
      id: cleanEmail,
      email: cleanEmail,
      name: data.name.trim(),
      employeeNumber: empNum,
      createdAt: new Date().toISOString(),
    };

    await saveOperatorMaster(newOperator);
    setCurrentOperator(newOperator);
  };

  const logout = async () => {
    await signOut(auth);
    setCurrentOperator(null);
    setCurrentUserObj(null);
  };

  const refreshOperator = async () => {
    if (firebaseUser && firebaseUser.email) {
      const op = await loadOperatorDetails(firebaseUser.email, firebaseUser);
      setCurrentOperator(op);
      if (currentUser) {
        const updated: User = {
          ...currentUser,
          displayName: op.name,
          employeeNumber: op.employeeNumber,
          department: op.department,
        };
        setCurrentUserObj(updated);
        setCurrentUser(updated);
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        currentOperator,
        currentUser,
        loading,
        login,
        register,
        logout,
        refreshOperator,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
