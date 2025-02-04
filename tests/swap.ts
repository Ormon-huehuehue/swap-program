import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Swap } from "../target/types/swap";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("swap", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Swap as Program<Swap>;
  
  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;
  let makerTokenAccountA: anchor.web3.PublicKey;
  let makerTokenAccountB: anchor.web3.PublicKey;
  let takerTokenAccountA: anchor.web3.PublicKey;
  let takerTokenAccountB: anchor.web3.PublicKey;
  let vault: anchor.web3.PublicKey;
  
  const offerId = new anchor.BN(1);
  const tokenAAmount = new anchor.BN(100);
  const tokenBAmount = new anchor.BN(200);
  
  const maker = anchor.web3.Keypair.generate();
  const taker = anchor.web3.Keypair.generate();

  it("Initialize test state", async () => {
    // Airdrop SOL to maker and taker
    await provider.connection.requestAirdrop(maker.publicKey, 2e9);
    await provider.connection.requestAirdrop(taker.publicKey, 2e9);

    // Create token mints
    mintA = await createMint(
      provider.connection,
      maker,
      maker.publicKey,
      null,
      6
    );
    
    mintB = await createMint(
      provider.connection,
      maker,
      maker.publicKey,
      null,
      6
    );

    // Create token accounts
    makerTokenAccountA = await createAccount(
      provider.connection,
      maker,
      mintA,
      maker.publicKey
    );
    
    makerTokenAccountB = await createAccount(
      provider.connection,
      maker,
      mintB,
      maker.publicKey
    );
    
    takerTokenAccountA = await createAccount(
      provider.connection,
      taker,
      mintA,
      taker.publicKey
    );
    
    takerTokenAccountB = await createAccount(
      provider.connection,
      taker,
      mintB,
      taker.publicKey
    );

    // Mint tokens to maker and taker
    await mintTo(
      provider.connection,
      maker,
      mintA,
      makerTokenAccountA,
      maker,
      tokenAAmount.toNumber()
    );
    
    await mintTo(
      provider.connection,
      maker,
      mintB,
      takerTokenAccountB,
      maker,
      tokenBAmount.toNumber()
    );
  });

  it("Make offer", async () => {
    // Derive PDA for offer account and vault
    const [offerPda, _] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("offer"),
        maker.publicKey.toBuffer(),
        offerId.toArrayLike(Buffer, "le", 8)
      ],
      program.programId
    );

    const [vaultPda, vaultBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("vault"), offerPda.toBuffer()],
      program.programId
    );
    
    vault = vaultPda;

    await program.methods
      .makeOffer(offerId, tokenAAmount, tokenBAmount)
      .accounts({
        maker: maker.publicKey,
        makerTokenAccount: makerTokenAccountA,
        tokenMintA: mintA,
        vault: vault,
        offer: offerPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    // Verify tokens were transferred to vault
    const vaultAccount = await getAccount(provider.connection, vault);
    assert.equal(vaultAccount.amount, tokenAAmount.toNumber());
  });

  it("Take offer", async () => {
    const [offerPda, _] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("offer"),
        maker.publicKey.toBuffer(),
        offerId.toArrayLike(Buffer, "le", 8)
      ],
      program.programId
    );

    await program.methods
      .takeOffer()
      .accounts({
        taker: taker.publicKey,
        maker: maker.publicKey,
        offer: offerPda,
        vault: vault,
        takerTokenAccountA: takerTokenAccountA,
        takerTokenAccountB: takerTokenAccountB,
        makerTokenAccountB: makerTokenAccountB,
        tokenMintA: mintA,
        tokenMintB: mintB,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([taker])
      .rpc();

    // Verify final token balances
    const takerTokenAAccount = await getAccount(provider.connection, takerTokenAccountA);
    const makerTokenBAccount = await getAccount(provider.connection, makerTokenAccountB);
    
    assert.equal(takerTokenAAccount.amount, tokenAAmount.toNumber());
    assert.equal(makerTokenBAccount.amount, tokenBAmount.toNumber());
  });
});
