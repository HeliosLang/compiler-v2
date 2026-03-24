import { describe, expect, it } from "bun:test"
import { Effect, Schema } from "effect"
import { Ledger, Network, ScriptContext, Uplc } from "@helios-lang/effect/Cardano"
import { compile } from "../src/index.js"

const utils = `module ScriptContext

export Address = struct 0{
    spending_cred: Data,
    staking_cred: Data
}

export RewardAddress = struct 0 {
  cred: Data
}

export TxOutput = struct 0{
    address: Address,
    assets: List[Pair[Data, List[Pair[Data, Data]]]],
    datum: Data
}

export UTxO = struct 0{
    ref: Data,
    output: TxOutput
}

export Tx = struct 0{
  inputs: List[Data],
  ref_inputs: List[Data],
  outputs: List[Data],
  fee: Data,
  minted: List[Pair[Data, List[Pair[Data, Data]]]],
  dcerts: Data,
  withdrawals: List[Pair[Data, Data]],
  validity_time_range: Data,
  signers: List[Data],
  redeemers: Data,
  datums: Data,
  tx_hash: ByteArray,
  votes: Data,
  proposal_procedures: Data,
  current_treasury_amount: Data,
  treasury_donation: Data
}

export ScriptContext = struct 0{
    tx: Tx,
    redeemer: Data,
    purpose: Data
}
`

const src = `validator anchor
import ScriptContext

export SEED: Data

export main = (_redeemer: Data) -> {
    ctx = scriptContextData as ScriptContext::ScriptContext
    tx = ctx.tx

    redeemer_pair = unConstrData(ctx.redeemer)
    redeemer_tag = fstPair(redeemer_pair)
    ptr_fields = sndPair(redeemer_pair)

    if (redeemer_tag == 0) {
      seed_ptr = unIData(headList(ptr_fields))
      input = get(tx.inputs, seed_ptr, 0) as ScriptContext::UTxO

      assert(input.ref == SEED, "seed not spent")
    } else {
      // index of the state input/ref-input  
      input_ptr = unIData(headList(ptr_fields))
      witness_ptr = unIData(headList(tailList(ptr_fields)))
      signer_ptr = unIData(headList(tailList(tailList(ptr_fields))))

      own_hash = get_own_hash(ctx.purpose, tx)

      if (redeemer_tag == 1) {
        // state token must be returned to this validator
        output_ptr = unIData(headList(tailList(tailList(tailList(ptr_fields)))))
        output_witness_ptr = unIData(headList(tailList(tailList(tailList(tailList(ptr_fields))))))
        output = get(tx.outputs, output_ptr, 0) as ScriptContext::TxOutput

        assert(contains_state_token(output.assets, own_hash), "output doesn't contain token")
        assert(output.address.spending_cred == constrData(1, mkCons(own_hash, mkNilData(()))), "output not returned")

        witness = validate_input(tx.inputs, input_ptr, own_hash, witness_ptr)

        validate_witness(witness, tx, signer_ptr)

        // make sure the witness is in the output datum
        output_witness = get(unListData(headList(sndPair(unConstrData(output.datum)))), output_witness_ptr, 0)

        assert(witness == output_witness, "witness not present in output")
      } else {
        witness = validate_input(tx.ref_inputs, input_ptr, own_hash, witness_ptr)

        validate_witness(witness, tx, signer_ptr)
      }
    } 
}

// returns the input datum
validate_input = (inputs: List[Data], input_ptr: Int, own_hash: Data, witness_ptr: Int): Data -> {
  input = get(inputs, input_ptr, 0) as ScriptContext::UTxO
  input_output = input.output
  input_assets = input_output.assets

  // make sure the input contains at least one state asset
  assert(contains_state_token(input_assets, own_hash), "input doesn't contain token")

  // now get the datum
  input_datum = unListData(headList(sndPair(unConstrData(input_output.datum))))

  get(input_datum, witness_ptr, 0)
}

validate_witness = (witness: Data, tx: ScriptContext::Tx, signer_ptr: Int): () -> {
  witness_pair = unConstrData(witness)
  witness_tag = fstPair(witness_pair)
  witness_hash = headList(sndPair(witness_pair))

  if (witness_tag == 0) {
    // signed by PubKeyHash
    pkh = get(tx.signers, signer_ptr, 0)

    assert(pkh == witness_hash, "unexpected pkh witness")
  } else {
    // witnessed by staking credential in withdrawal
    pair = get_pair(tx.withdrawals, signer_ptr, 0)

    withdrawal_cred = (fstPair(pair) as ScriptContext::RewardAddress).cred
    withdrawal_hash = headList(sndPair(unConstrData(withdrawal_cred)))

    assert(withdrawal_hash == witness_hash, "unexpected withdrawal cred")
  }
}

get_own_hash = (purpose: Data, tx: ScriptContext::Tx): Data -> {
    purpose_pair = unConstrData(purpose)
    purpose_tag = fstPair(purpose_pair)
    purpose_fields = sndPair(purpose_pair)

    if (purpose_tag == 0) {
        // minting
        policy = headList(purpose_fields)

        // can never mint/burn the state token
        if (contains_state_token(tx.minted, policy)) {
            error("can't mint token")
        } else {
            policy
        }
    } else if (purpose_tag == 1) {
        // spending validator credential
        input = find_input(tx.inputs, headList(purpose_fields)) as ScriptContext::UTxO

        input.output.address.spending_cred | unConstrData | sndPair | headList
    } else if (purpose_tag == 2) {
        // rewarding
        headList(sndPair(unConstrData(headList(sndPair(unConstrData(headList(purpose_fields)))))))
    } else if (purpose_tag == 3) {
        // certifying
        cert = headList(tailList(purpose_fields))
        cert_pair = unConstrData(cert)
        cert_tag = fstPair(cert_pair)
        cert_fields = sndPair(cert_pair)

        if (lessThanInteger(cert_tag, 4)) {
            headList(sndPair(unConstrData(headList(cert_fields))))
        } else {
            headList(sndPair(unConstrData(headList(sndPair(unConstrData(headList(cert_fields)))))))
        }
    } else if (purpose_tag == 4) {
        // voting
        headList(sndPair(unConstrData(headList(sndPair(unConstrData(headList(sndPair(unConstrData(headList(purpose_fields))))))))))
    } else {
        error("unsupported purpose")
    }
}

find_input = (inputs: List[Data], ref: Data): Data -> {
    input = headList(inputs)
    input_fields = sndPair(unConstrData(input))

    if (headList(input_fields) == ref) {
        input
    } else {
        find_input(tailList(inputs), ref)
    }
}

get = (items: List[Data], index: Int, running_idx: Int): Data -> {
    if (index == running_idx) {
        headList(items)
    } else {
        get(items, index, addInteger(running_idx, 1))
    }
}

get_pair = (items: List[Pair[Data, Data]], index: Int, running_idx: Int): Pair[Data, Data] -> {
    if (index == running_idx) {
        headList(items)
    } else {
        get_pair(tailList(items), index, addInteger(running_idx, 1))
    }
}

contains_state_token = (assets: List[Pair[Data, List[Pair[Data, Data]]]], policy: Data): Bool -> {
    if (nullList(assets)) {
        false
    } else {
        entry = headList(assets)

        if (entry.first == policy) {
            tokens_contain(entry.second, bData(#))
        } else {
            contains_state_token(tailList(assets), policy)
        }
    }
}
    
tokens_contain = (map: List[Pair[Data, Data]], token_name: Data): Bool -> {
    if (nullList(map)) {
        false
    } else {
        entry = headList(map)

        if (fstPair(entry) == token_name) {
            true
        } else {
            tokens_contain(tailList(map), token_name)
        }
    }
}`

function compileAnchorScript(): Uplc.Script.Script<3> {
  const entryPoints = compile(
    [
      {
        name: "anchor.hl",
        content: src
      },
      {
        name: "ScriptContext.hl",
        content: utils
      }
    ],
    {
      positionalParams: ["anchor::SEED"]
    }
  )

  const main = entryPoints["anchor::main"]

  if (main === undefined) {
    throw new Error("expected anchor::main entrypoint")
  }

  return main
}

function evalScript(
  script: Uplc.Script.Script<3>,
  args: Uplc.Value.Value[]
): Uplc.Cek.Value {
  const result = evalScriptResult(script, args)

  if (result.value._tag == "Left") {
    throw new Error(result.value.left.error)
  }

  return result.value.right
}

function evalScriptResult(
  script: Uplc.Script.Script<3>,
  args: Uplc.Value.Value[]
) {
  return Effect.runSync(Uplc.Script.eval(script, args))
}

function expectEvalFailureMessage(
  result: ReturnType<typeof evalScriptResult>,
  pattern: RegExp
) {
  expect(result.value._tag).toBe("Left")

  if (result.value._tag != "Left") {
    throw new Error("expected script evaluation to fail")
  }

  expect(result.value.left.error).toMatch(pattern)
}

function makeScriptContextArgs(tx: Ledger.Tx.Tx, redeemerIndex: number) {
  return Effect.runSync(
    ScriptContext.makeArgs(3, tx, redeemerIndex).pipe(
      Effect.provideService(Network.IsMainnet, false),
      Effect.provideService(Network.Params.params, Network.Params.testParams)
    )
  )
}

function makeRedeemerTag1Setup(script: Uplc.Script.Script<3>) {
  const txHash = Schema.decodeSync(Ledger.TxHash.TxHash)("11".repeat(32))
  const seedRef = Ledger.UTxORef.make(txHash, 0)
  const seedRefData = Schema.encodeSync(Ledger.UTxORef.FromUplcDataV3)(seedRef)
  const signer = Schema.decodeSync(Ledger.PubKeyHash.PubKeyHash)("22".repeat(28))
  const appliedScript = Effect.runSync(
    Uplc.Script.apply(script, [{ data: seedRefData }])
  )
  const scriptHash = Uplc.Script.hash(appliedScript)
  const scriptAddress = Ledger.Address.make(
    false,
    Ledger.Credential.makeValidator(scriptHash)
  )
  const stateWitness = Uplc.Data.makeConstrData(0, [
    Uplc.Data.makeByteArrayData(signer)
  ])
  const stateDatum = Uplc.Data.makeListData([stateWitness])
  const stateAssets = {
    "": 1_000_000n,
    [scriptHash]: 1n
  }

  return {
    txHash,
    seedRefData,
    signer,
    scriptHash,
    scriptAddress,
    stateDatum,
    stateAssets
  }
}

function makeRedeemerTag2Setup(script: Uplc.Script.Script<3>) {
  const { txHash, seedRefData, scriptHash, scriptAddress } =
    makeRedeemerTag1Setup(script)
  const stakingValidatorHash = Schema.decodeSync(
    Ledger.ValidatorHash.ValidatorHash
  )("55".repeat(28))
  const withdrawalAddress = Ledger.RewardAddress.make(
    false,
    Ledger.Credential.makeValidator(stakingValidatorHash)
  )
  const stateWitness = Uplc.Data.makeConstrData(1, [
    Uplc.Data.makeByteArrayData(stakingValidatorHash)
  ])
  const stateDatum = Uplc.Data.makeListData([stateWitness])
  const stateAssets = {
    "": 1_000_000n,
    [scriptHash]: 1n
  }

  return {
    txHash,
    seedRefData,
    scriptHash,
    scriptAddress,
    stakingValidatorHash,
    withdrawalAddress,
    stateDatum,
    stateAssets
  }
}

describe("anchor", () => {
  it("compiles the embedded validator source", () => {
    const script = compileAnchorScript()
    expect(script).toBeDefined()

    console.log("Anchor validator size:", script.root.length)
  })

  it("spends the parametrized seed when redeemer tag is 0", () => {
    const script = compileAnchorScript()
    const txHash = Schema.decodeSync(Ledger.TxHash.TxHash)("11".repeat(32))
    const seedRef = Ledger.UTxORef.make(txHash, 0)
    const seedRefData = Schema.encodeSync(Ledger.UTxORef.FromUplcDataV3)(seedRef)
    const pkh = Schema.decodeSync(Ledger.PubKeyHash.PubKeyHash)("22".repeat(28))
    const address = Ledger.Address.make(
      false,
      Ledger.Credential.makePubKey(pkh)
    )

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [
          {
            ref: seedRef,
            output: {
              address,
              assets: {
                "": 1_000_000n
              }
            }
          }
        ],
        outputs: [],
        fee: 0n,
        dcerts: [],
        withdrawals: [],
        minted: {},
        collateral: [],
        signers: [],
        totalCollateral: 0n,
        refInputs: []
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Spending",
            inputIndex: 0,
            data: Uplc.Data.makeConstrData(0, [Uplc.Data.makeIntData(0)]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = Effect.runSync(
      ScriptContext.makeArgs(3, tx, 0).pipe(
        Effect.provideService(Network.IsMainnet, false),
        Effect.provideService(Network.Params.params, Network.Params.testParams)
      )
    )

    expect(scriptContextArgs).toHaveLength(1)

    const value = evalScript(script, [{ data: seedRefData }, scriptContextArgs[0]])

    expect(value).toEqual({
      _tag: "Const",
      value: null
    })
  })

  it("fails validation when the parametrized seed isn't spent", () => {
    const script = compileAnchorScript()
    const txHash = Schema.decodeSync(Ledger.TxHash.TxHash)("11".repeat(32))
    const seedRef = Ledger.UTxORef.make(txHash, 0)
    const otherRef = Ledger.UTxORef.make(txHash, 1)
    const seedRefData = Schema.encodeSync(Ledger.UTxORef.FromUplcDataV3)(seedRef)
    const pkh = Schema.decodeSync(Ledger.PubKeyHash.PubKeyHash)("22".repeat(28))
    const address = Ledger.Address.make(
      false,
      Ledger.Credential.makePubKey(pkh)
    )

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [
          {
            ref: otherRef,
            output: {
              address,
              assets: {
                "": 1_000_000n
              }
            }
          }
        ],
        outputs: [],
        fee: 0n,
        dcerts: [],
        withdrawals: [],
        minted: {},
        collateral: [],
        signers: [],
        totalCollateral: 0n,
        refInputs: []
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Spending",
            inputIndex: 0,
            data: Uplc.Data.makeConstrData(0, [Uplc.Data.makeIntData(0)]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = Effect.runSync(
      ScriptContext.makeArgs(3, tx, 0).pipe(
        Effect.provideService(Network.IsMainnet, false),
        Effect.provideService(Network.Params.params, Network.Params.testParams)
      )
    )

    expect(scriptContextArgs).toHaveLength(1)

    const result = evalScriptResult(script, [
      { data: seedRefData },
      scriptContextArgs[0]
    ])

    expectEvalFailureMessage(result, /seed not spent/)
  })

  it("keeps the state NFT at the script address when redeemer tag is 1 using ScriptContext.makeArgs()", () => {
    const script = compileAnchorScript()
    const {
      txHash,
      seedRefData,
      signer,
      scriptHash,
      scriptAddress,
      stateDatum,
      stateAssets
    } = makeRedeemerTag1Setup(script)

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [
          {
            ref: Ledger.UTxORef.make(txHash, 1),
            output: {
              address: scriptAddress,
              assets: stateAssets,
              datum: stateDatum
            }
          }
        ],
        outputs: [
          {
            address: scriptAddress,
            assets: stateAssets,
            datum: stateDatum
          }
        ],
        fee: 0n,
        dcerts: [],
        withdrawals: [],
        minted: {},
        collateral: [],
        signers: [signer],
        totalCollateral: 0n,
        refInputs: []
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Spending",
            inputIndex: 0,
            data: Uplc.Data.makeConstrData(1, [
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0)
            ]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = makeScriptContextArgs(tx, 0)

    expect(scriptContextArgs).toHaveLength(1)

    const value = evalScript(script, [{ data: seedRefData }, scriptContextArgs[0]])

    expect(value).toEqual({
      _tag: "Const",
      value: null
    })
  })

  it("fails validation for redeemer tag 1 when the input doesn't contain the state NFT", () => {
    const script = compileAnchorScript()
    const {
      txHash,
      seedRefData,
      signer,
      scriptHash,
      scriptAddress,
      stateDatum,
      stateAssets
    } = makeRedeemerTag1Setup(script)
    const nonStateAssets = {
      "": 1_000_000n,
      [`${scriptHash}01`]: 1n
    }

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [
          {
            ref: Ledger.UTxORef.make(txHash, 1),
            output: {
              address: scriptAddress,
              assets: nonStateAssets,
              datum: stateDatum
            }
          }
        ],
        outputs: [
          {
            address: scriptAddress,
            assets: stateAssets,
            datum: stateDatum
          }
        ],
        fee: 0n,
        dcerts: [],
        withdrawals: [],
        minted: {},
        collateral: [],
        signers: [signer],
        totalCollateral: 0n,
        refInputs: []
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Spending",
            inputIndex: 0,
            data: Uplc.Data.makeConstrData(1, [
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0)
            ]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = makeScriptContextArgs(tx, 0)

    expect(scriptContextArgs).toHaveLength(1)

    const result = evalScriptResult(script, [
      { data: seedRefData },
      scriptContextArgs[0]
    ])

    expectEvalFailureMessage(result, /input doesn't contain token/)
  })

  it("fails validation for redeemer tag 1 when the output doesn't return the state NFT", () => {
    const script = compileAnchorScript()
    const {
      txHash,
      seedRefData,
      signer,
      scriptAddress,
      stateDatum,
      stateAssets
    } = makeRedeemerTag1Setup(script)

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [
          {
            ref: Ledger.UTxORef.make(txHash, 1),
            output: {
              address: scriptAddress,
              assets: stateAssets,
              datum: stateDatum
            }
          }
        ],
        outputs: [
          {
            address: scriptAddress,
            assets: {
              "": 1_000_000n
            }
          }
        ],
        fee: 0n,
        dcerts: [],
        withdrawals: [],
        minted: {},
        collateral: [],
        signers: [signer],
        totalCollateral: 0n,
        refInputs: []
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Spending",
            inputIndex: 0,
            data: Uplc.Data.makeConstrData(1, [
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0)
            ]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = makeScriptContextArgs(tx, 0)

    expect(scriptContextArgs).toHaveLength(1)

    const result = evalScriptResult(script, [
      { data: seedRefData },
      scriptContextArgs[0]
    ])

    expectEvalFailureMessage(result, /output doesn't contain token/)
  })

  it("fails validation for redeemer tag 1 when the pubkey witness doesn't match the signer", () => {
    const script = compileAnchorScript()
    const {
      txHash,
      seedRefData,
      scriptAddress,
      stateDatum,
      stateAssets
    } = makeRedeemerTag1Setup(script)
    const wrongSigner = Schema.decodeSync(Ledger.PubKeyHash.PubKeyHash)(
      "66".repeat(28)
    )

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [
          {
            ref: Ledger.UTxORef.make(txHash, 1),
            output: {
              address: scriptAddress,
              assets: stateAssets,
              datum: stateDatum
            }
          }
        ],
        outputs: [
          {
            address: scriptAddress,
            assets: stateAssets,
            datum: stateDatum
          }
        ],
        fee: 0n,
        dcerts: [],
        withdrawals: [],
        minted: {},
        collateral: [],
        signers: [wrongSigner],
        totalCollateral: 0n,
        refInputs: []
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Spending",
            inputIndex: 0,
            data: Uplc.Data.makeConstrData(1, [
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0)
            ]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = makeScriptContextArgs(tx, 0)

    expect(scriptContextArgs).toHaveLength(1)

    const result = evalScriptResult(script, [
      { data: seedRefData },
      scriptContextArgs[0]
    ])

    expectEvalFailureMessage(result, /unexpected pkh witness/)
  })

  it("keeps the state NFT at the script address for redeemer tag 1 with a minting purpose", () => {
    const script = compileAnchorScript()
    const {
      txHash,
      seedRefData,
      signer,
      scriptHash,
      scriptAddress,
      stateDatum,
      stateAssets
    } = makeRedeemerTag1Setup(script)

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [
          {
            ref: Ledger.UTxORef.make(txHash, 1),
            output: {
              address: scriptAddress,
              assets: stateAssets,
              datum: stateDatum
            }
          }
        ],
        outputs: [
          {
            address: scriptAddress,
            assets: stateAssets,
            datum: stateDatum
          }
        ],
        fee: 0n,
        dcerts: [],
        withdrawals: [],
        minted: {
          [`${scriptHash}01`]: 1n
        },
        collateral: [],
        signers: [signer],
        totalCollateral: 0n,
        refInputs: []
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Minting",
            policyIndex: 0,
            data: Uplc.Data.makeConstrData(1, [
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0)
            ]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = makeScriptContextArgs(tx, 0)

    expect(scriptContextArgs).toHaveLength(1)

    const value = evalScript(script, [{ data: seedRefData }, scriptContextArgs[0]])

    expect(value).toEqual({
      _tag: "Const",
      value: null
    })
  })

  it("fails validation for redeemer tag 1 with a minting purpose if another state NFT is minted", () => {
    const script = compileAnchorScript()
    const { seedRefData, scriptHash } = makeRedeemerTag1Setup(script)

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [],
        outputs: [],
        fee: 0n,
        dcerts: [],
        withdrawals: [],
        minted: {
          [scriptHash]: 1n
        },
        collateral: [],
        signers: [],
        totalCollateral: 0n,
        refInputs: []
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Minting",
            policyIndex: 0,
            data: Uplc.Data.makeConstrData(1, [
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0)
            ]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = makeScriptContextArgs(tx, 0)

    expect(scriptContextArgs).toHaveLength(1)

    const result = evalScriptResult(script, [
      { data: seedRefData },
      scriptContextArgs[0]
    ])

    expectEvalFailureMessage(result, /can't mint token/)
  })

  it("succeeds for redeemer tag 1 with a minting purpose if a non-empty token name is minted", () => {
    const script = compileAnchorScript()
    const {
      txHash,
      seedRefData,
      signer,
      scriptHash,
      scriptAddress,
      stateDatum,
      stateAssets
    } = makeRedeemerTag1Setup(script)

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [
          {
            ref: Ledger.UTxORef.make(txHash, 1),
            output: {
              address: scriptAddress,
              assets: stateAssets,
              datum: stateDatum
            }
          }
        ],
        outputs: [
          {
            address: scriptAddress,
            assets: stateAssets,
            datum: stateDatum
          }
        ],
        fee: 0n,
        dcerts: [],
        withdrawals: [],
        minted: {
          [`${scriptHash}01`]: 1n
        },
        collateral: [],
        signers: [signer],
        totalCollateral: 0n,
        refInputs: []
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Minting",
            policyIndex: 0,
            data: Uplc.Data.makeConstrData(1, [
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0)
            ]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = makeScriptContextArgs(tx, 0)

    expect(scriptContextArgs).toHaveLength(1)

    const value = evalScript(script, [{ data: seedRefData }, scriptContextArgs[0]])

    expect(value).toEqual({
      _tag: "Const",
      value: null
    })
  })

  it("fails validation for redeemer tag 1 with a minting purpose if the output isn't sent to the script address", () => {
    const script = compileAnchorScript()
    const {
      txHash,
      seedRefData,
      signer,
      scriptHash,
      scriptAddress,
      stateDatum,
      stateAssets
    } = makeRedeemerTag1Setup(script)
    const wrongPkh = Schema.decodeSync(Ledger.PubKeyHash.PubKeyHash)(
      "44".repeat(28)
    )
    const wrongAddress = Ledger.Address.make(
      false,
      Ledger.Credential.makePubKey(wrongPkh)
    )

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [
          {
            ref: Ledger.UTxORef.make(txHash, 1),
            output: {
              address: scriptAddress,
              assets: stateAssets,
              datum: stateDatum
            }
          }
        ],
        outputs: [
          {
            address: wrongAddress,
            assets: stateAssets
          }
        ],
        fee: 0n,
        dcerts: [],
        withdrawals: [],
        minted: {
          [`${scriptHash}01`]: 1n
        },
        collateral: [],
        signers: [signer],
        totalCollateral: 0n,
        refInputs: []
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Minting",
            policyIndex: 0,
            data: Uplc.Data.makeConstrData(1, [
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0)
            ]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = makeScriptContextArgs(tx, 0)

    expect(scriptContextArgs).toHaveLength(1)

    const result = evalScriptResult(script, [
      { data: seedRefData },
      scriptContextArgs[0]
    ])

    expectEvalFailureMessage(result, /output not returned/)
  })

  it("succeeds for redeemer tag 2 when the state NFT is in a reference input and witnessed by a withdrawal validator", () => {
    const script = compileAnchorScript()
    const {
      txHash,
      seedRefData,
      scriptHash,
      scriptAddress
    } = makeRedeemerTag1Setup(script)
    const stakingValidatorHash = Schema.decodeSync(
      Ledger.ValidatorHash.ValidatorHash
    )("55".repeat(28))
    const stateWitness = Uplc.Data.makeConstrData(1, [
      Uplc.Data.makeByteArrayData(stakingValidatorHash)
    ])
    const stateDatum = Uplc.Data.makeListData([stateWitness])
    const stateAssets = {
      "": 1_000_000n,
      [scriptHash]: 1n
    }
    const withdrawalAddress = Ledger.RewardAddress.make(
      false,
      Ledger.Credential.makeValidator(stakingValidatorHash)
    )

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [],
        refInputs: [
          {
            ref: Ledger.UTxORef.make(txHash, 2),
            output: {
              address: scriptAddress,
              assets: stateAssets,
              datum: stateDatum
            }
          }
        ],
        outputs: [],
        fee: 0n,
        dcerts: [],
        withdrawals: [[withdrawalAddress, 0n]],
        minted: {
          [`${scriptHash}01`]: 1n
        },
        collateral: [],
        signers: [],
        totalCollateral: 0n
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Minting",
            policyIndex: 0,
            data: Uplc.Data.makeConstrData(2, [
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0)
            ]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = makeScriptContextArgs(tx, 0)

    expect(scriptContextArgs).toHaveLength(1)

    const value = evalScript(script, [{ data: seedRefData }, scriptContextArgs[0]])

    expect(value).toEqual({
      _tag: "Const",
      value: null
    })
  })

  it("fails validation for redeemer tag 2 when the withdrawal validator witness doesn't match the withdrawal", () => {
    const script = compileAnchorScript()
    const {
      txHash,
      seedRefData,
      scriptHash,
      scriptAddress,
      stateDatum,
      stateAssets
    } = makeRedeemerTag2Setup(script)
    const wrongWithdrawalHash = Schema.decodeSync(Ledger.ValidatorHash.ValidatorHash)(
      "77".repeat(28)
    )
    const wrongWithdrawalAddress = Ledger.RewardAddress.make(
      false,
      Ledger.Credential.makeValidator(wrongWithdrawalHash)
    )

    const tx: Ledger.Tx.Tx = {
      body: {
        inputs: [],
        refInputs: [
          {
            ref: Ledger.UTxORef.make(txHash, 2),
            output: {
              address: scriptAddress,
              assets: stateAssets,
              datum: stateDatum
            }
          }
        ],
        outputs: [],
        fee: 0n,
        dcerts: [],
        withdrawals: [[wrongWithdrawalAddress, 0n]],
        minted: {
          [`${scriptHash}01`]: 1n
        },
        collateral: [],
        signers: [],
        totalCollateral: 0n
      },
      witnesses: {
        signatures: [],
        datums: [],
        redeemers: [
          {
            _tag: "Minting",
            policyIndex: 0,
            data: Uplc.Data.makeConstrData(2, [
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0),
              Uplc.Data.makeIntData(0)
            ]),
            cost: {
              cpu: 0n,
              mem: 0n
            }
          }
        ],
        nativeScripts: [],
        v1Scripts: [],
        v2Scripts: [],
        v3Scripts: [],
        v2RefScripts: [],
        v3RefScripts: []
      },
      isValid: true
    }

    const scriptContextArgs = makeScriptContextArgs(tx, 0)

    expect(scriptContextArgs).toHaveLength(1)

    const result = evalScriptResult(script, [
      { data: seedRefData },
      scriptContextArgs[0]
    ])

    expectEvalFailureMessage(result, /unexpected withdrawal cred/)
  })

  it("fails validation when the purpose tag is unsupported", () => {
    const script = compileAnchorScript()
    const { seedRefData } = makeRedeemerTag1Setup(script)
    const noneData = Uplc.Data.makeConstrData(1, [])
    const scriptContextData = Uplc.Data.makeConstrData(0, [
      Uplc.Data.makeConstrData(0, [
        Uplc.Data.makeListData([]),
        Uplc.Data.makeListData([]),
        Uplc.Data.makeListData([]),
        Uplc.Data.makeIntData(0),
        Uplc.Data.makeMapData([]),
        Uplc.Data.makeListData([]),
        Uplc.Data.makeMapData([]),
        noneData,
        Uplc.Data.makeListData([]),
        Uplc.Data.makeMapData([]),
        Uplc.Data.makeMapData([]),
        Uplc.Data.makeByteArrayData("33".repeat(32)),
        Uplc.Data.makeMapData([]),
        Uplc.Data.makeListData([]),
        noneData,
        noneData
      ]),
      Uplc.Data.makeConstrData(1, [
        Uplc.Data.makeIntData(0),
        Uplc.Data.makeIntData(0),
        Uplc.Data.makeIntData(0),
        Uplc.Data.makeIntData(0),
        Uplc.Data.makeIntData(0)
      ]),
      Uplc.Data.makeConstrData(5, [])
    ])

    const result = evalScriptResult(script, [
      { data: seedRefData },
      { data: scriptContextData }
    ])

    expectEvalFailureMessage(result, /unsupported purpose/)
  })
})
