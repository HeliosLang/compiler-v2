import { describe, expect, it } from "bun:test"
import { compile } from "../src/index.js"

const utils = `module ScriptContext

export Address = struct 0{
    spending_cred: Data,
    staking_cred: Data
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

    if (redeemer_tag == 0) {
        if (spends_seed(tx.inputs)) {
            ()
        } else {
            error()
        }
    } else {
        // index of the state input/ref-input
        ptr_fields = sndPair(redeemer_pair)
        input_ptr = unIData(headList(ptr_fields))
        witness_ptr = unIData(headList(tailList(ptr_fields)))
        signer_ptr = unIData(headList(tailList(tailList(ptr_fields))))

        own_hash = get_own_hash(
            ctx.purpose,
            tx
        )

        inputs = if (redeemer_tag == 1) {
            // state token must be returned to this validator
            output_ptr = unIData(headList(tailList(tailList(tailList(ptr_fields)))))
            output = get(tx.outputs, output_ptr, 0) as ScriptContext::TxOutput

            if (contains_state_token(output.assets, own_hash)) {
                if (output.address.spending_cred == constrData(1, mkCons(own_hash, mkNilData(())) )) {
                    tx.inputs
                } else {
                    error()
                }
            } else {
                error()
            }
        } else {
            tx.ref_inputs
        }

        input = get(inputs, input_ptr, 0) as ScriptContext::UTxO
        input_output = input.output
        input_assets = input_output.assets

        // make sure the input contains at least one state asset
        if (contains_state_token(input_assets, own_hash)) {
            // now get the datum
            input_datum = unListData(headList(sndPair(unConstrData(input_output.datum))))

            witness = unConstrData(get(input_datum, witness_ptr, 0))
            witness_tag = fstPair(witness)

            if (witness_tag == 0) {
                // signed by PubKeyHash
                pkh = get(tx.signers, signer_ptr, 0)

                if (pkh == headList(sndPair(witness))) {
                    ()
                } else {
                    error()
                }
            } else {
                // witnessed by staking credential in withdrawal
                pair = get_pair(tx.withdrawals, signer_ptr, 0)

                if (fstPair(pair) == headList(sndPair(witness))) {
                    ()
                } else {
                    error()
                }
            }
        } else {
            error()
        }
    } 
}

spends_seed = (inputs: List[Data]): Bool -> {
    if (nullList(inputs)) {
        false
    } else if (headList(sndPair(unConstrData(headList(inputs)))) == SEED) {
        true
    } else {
        spends_seed(tailList(inputs))
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
            error()
        } else {
            policy
        }
    } else if (purpose_tag == 1) {
        // spending validator credential
        input = sndPair(unConstrData(find_input(tx.inputs, headList(purpose_fields))))
        input_output = sndPair(unConstrData(headList(tailList(input))))
        input_address = sndPair(unConstrData(headList(input_output)))

        headList(input_address)
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
        error()
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

describe("anchor", () => {
  it("compiles the embedded validator source", () => {
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

    expect(entryPoints["anchor::main"]).toBeDefined()

    console.log(entryPoints["anchor::main"].root.length)
  })
})
