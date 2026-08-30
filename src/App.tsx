import { useState, useEffect } from "react";
import * as freighter from "@stellar/freighter-api";
import * as StellarSdk from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const ServerClass = StellarSdk.Horizon?.Server || (StellarSdk as any).Server;
const server = new ServerClass(HORIZON_URL);

export default function App() {
  const [publicKey, setPublicKey] = useState<string>("");
  const [balance, setBalance] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState<boolean>(false);

  // Form State
  const [recipient, setRecipient] = useState<string>("");
  const [amount, setAmount] = useState<string>("");

  // Status Feedback State
  const [status, setStatus] = useState<{
    type: "idle" | "loading" | "success" | "error";
    message: string;
    txHash?: string;
  }>({ type: "idle", message: "" });

  useEffect(() => {
    checkConnection();
  }, []);

  useEffect(() => {
    if (publicKey) {
      fetchBalance(publicKey);
    } else {
      setBalance(null);
    }
  }, [publicKey]);

  const getUserAddress = async (): Promise<string | null> => {
    try {
      const freighterObj = freighter as any;
      const getAddrFn = freighterObj.getAddress || freighterObj.getPublicKey;
      if (!getAddrFn) return null;
      const res = await getAddrFn();
      return typeof res === "string" ? res : res?.address || res?.publicKey || null;
    } catch {
      return null;
    }
  };

  const checkConnection = async () => {
    try {
      const res = await (freighter as any).isConnected();
      if (typeof res === "boolean" ? res : res?.isConnected) {
        const key = await getUserAddress();
        if (key) setPublicKey(key);
      }
    } catch (err) {
      console.error("Connection check failed:", err);
    }
  };

  const connectWallet = async () => {
    setStatus({ type: "idle", message: "" });
    try {
      const accessGranted = await (freighter as any).requestAccess();
      if (accessGranted) {
        const key = await getUserAddress();
        if (key) {
          setPublicKey(key);
        }
      } else {
        setStatus({ type: "error", message: "Wallet access denied by user." });
      }
    } catch (err: any) {
      setStatus({ type: "error", message: err.message || "Failed to connect wallet." });
    }
  };

  const disconnectWallet = () => {
    setPublicKey("");
    setBalance(null);
    setStatus({ type: "idle", message: "" });
  };

  const fetchBalance = async (address: string) => {
    setLoadingBalance(true);
    try {
      const account = await server.loadAccount(address);
      const xlmBalance = account.balances.find(
        (b: any) => b.asset_type === "native"
      );
      setBalance(xlmBalance ? xlmBalance.balance : "0");
    } catch (err) {
      console.error("Failed to fetch balance:", err);
      setBalance("Error fetching balance");
    } finally {
      setLoadingBalance(false);
    }
  };

  const handleSendPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) return;

    if (!recipient || !amount || parseFloat(amount) <= 0) {
      setStatus({
        type: "error",
        message: "Please enter a valid recipient address and amount.",
      });
      return;
    }

    setStatus({ type: "loading", message: "Building transaction..." });

    try {
      const sourceAccount = await server.loadAccount(publicKey);

      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: "10000",
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: recipient,
            asset: StellarSdk.Asset.native(),
            amount: amount,
          })
        )
        .setTimeout(30)
        .build();

      setStatus({ type: "loading", message: "Awaiting wallet signature..." });

      const signedResult: any = await (freighter as any).signTransaction(tx.toXDR(), {
        networkPassphrase: StellarSdk.Networks.TESTNET,
      });

      const signedXdr = typeof signedResult === "string" 
        ? signedResult 
        : signedResult?.signedTxXdr;

      if (!signedXdr) {
        throw new Error(signedResult?.error || "User canceled or failed to sign transaction.");
      }

      setStatus({ type: "loading", message: "Submitting to Stellar Testnet..." });
      const transactionResult = StellarSdk.TransactionBuilder.fromXDR(
        signedXdr,
        StellarSdk.Networks.TESTNET
      );
      const response = await server.submitTransaction(transactionResult);

      setStatus({
        type: "success",
        message: "Payment successfully sent!",
        txHash: response.hash,
      });

      setAmount("");
      setRecipient("");
      fetchBalance(publicKey);
    } catch (err: any) {
      console.error("Transaction error:", err);
      setStatus({
        type: "error",
        message:
          err.response?.data?.extras?.result_codes?.operations?.[0] ||
          err.message ||
          "Transaction failed.",
      });
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.card}>
        <h1>Stellar Testnet Payment dApp</h1>
        {!publicKey ? (
          <button style={styles.button} onClick={connectWallet}>
            Connect Freighter Wallet
          </button>
        ) : (
          <div>
            <div style={styles.walletInfo}>
              <p>
                <strong>Connected:</strong> {publicKey.slice(0, 6)}...{publicKey.slice(-6)}
              </p>
              <p>
                <strong>Balance:</strong>{" "}
                {loadingBalance ? "Loading..." : `${balance} XLM`}
              </p>
            </div>
            <button style={styles.disconnectButton} onClick={disconnectWallet}>
              Disconnect
            </button>
          </div>
        )}
      </header>

      {publicKey && (
        <section style={styles.card}>
          <h2>Send XLM Payment</h2>
          <form onSubmit={handleSendPayment} style={styles.form}>
            <div style={styles.inputGroup}>
              <label>Recipient Address:</label>
              <input
                type="text"
                placeholder="G..."
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                style={styles.input}
                required
              />
            </div>

            <div style={styles.inputGroup}>
              <label>Amount (XLM):</label>
              <input
                type="number"
                step="any"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={styles.input}
                required
              />
            </div>

            <button
              type="submit"
              style={styles.button}
              disabled={status.type === "loading"}
            >
              {status.type === "loading" ? "Processing..." : "Send Payment"}
            </button>
          </form>

          {status.type !== "idle" && (
            <div
              style={{
                ...styles.statusBox,
                backgroundColor:
                  status.type === "error"
                    ? "#ffebee"
                    : status.type === "success"
                    ? "#e8f5e9"
                    : "#e3f2fd",
                color:
                  status.type === "error"
                    ? "#c62828"
                    : status.type === "success"
                    ? "#2e7d32"
                    : "#1565c0",
              }}
            >
              <p>
                <strong>Status:</strong> {status.message}
              </p>
              {status.txHash && (
                <p style={{ wordBreak: "break-all" }}>
                  <strong>Tx Hash:</strong>{" "}
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${status.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#1565c0" }}
                  >
                    {status.txHash}
                  </a>
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    maxWidth: "550px",
    margin: "40px auto",
    fontFamily: "sans-serif",
    padding: "0 20px",
  },
  card: {
    background: "#1e1e2e",
    color: "#ffffff",
    padding: "24px",
    borderRadius: "12px",
    marginBottom: "20px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
  },
  button: {
    width: "100%",
    padding: "12px",
    borderRadius: "6px",
    border: "none",
    background: "#6366f1",
    color: "#fff",
    fontSize: "16px",
    fontWeight: "bold",
    cursor: "pointer",
    marginTop: "10px",
  },
  disconnectButton: {
    padding: "8px 16px",
    borderRadius: "6px",
    border: "1px solid #ff4d4d",
    background: "transparent",
    color: "#ff4d4d",
    cursor: "pointer",
    marginTop: "10px",
  },
  walletInfo: {
    margin: "12px 0",
    lineHeight: "1.6",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  input: {
    padding: "10px",
    borderRadius: "6px",
    border: "1px solid #444",
    background: "#2b2b3d",
    color: "#fff",
    fontSize: "14px",
  },
  statusBox: {
    marginTop: "20px",
    padding: "12px",
    borderRadius: "6px",
    fontSize: "14px",
  },
};