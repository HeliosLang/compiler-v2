import { describe, expect, it } from "bun:test"
import { compile } from "../src/index.js"

const src = `validator anchor

export SEED: Data

export main = (redeemer: Data) -> {
    ctx = unConstrData(scriptContextData) | sndPair
    tx = headList(ctx) | unConstrData | sndPair

    redeemer_pair = unConstrData(redeemer)
    redeemer_tag = fstPair(redeemer_pair)

    if (redeemer_tag == 0) {
        if (spends_seed(unListData(headList(tx)))) {
            ()
        } else {
            error()
        }
    } else {
        // index of the state input/ref-input
        ptr_fields = sndPair(redeemer_pair)
        input_ptr = headList(ptr_fields) | unIData
        witness_ptr = tailList(ptr_fields) | headList | unIData
        signer_ptr = tailList(ptr_fields) | tailList | headList | unIData

        own_hash = get_own_hash(
            headList(tailList(tailList(ctx))),
            tx
        )

        inputs = unListData(
            if (redeemer_tag == 1) {
                headList(tx)
            } else {
                headList(tailList(tx))
            }
        )

        input = get(inputs, input_ptr, 0) | unConstrData | sndPair
        input_output = tailList(input) | headList | unConstrData | sndPair
        input_assets = tailList(input_output) | headList | unMapData

        // make sure the input contains at least one state asset
        if (assets_contain(input_assets, own_hash)) {
            // now get the datum
            input_datum = unListData(headList(sndPair(unConstrData(headList(tailList(tailList(input_output)))))))

            witness = unConstrData(get(input_datum, witness_ptr, 0))
            witness_tag = fstPair(witness)

            if (witness_tag == 0) {
                // signed by PubKeyHash
                pkh = get(unListData(headList(tailList(tailList(tailList(tailList(tailList(tailList(tailList(tailList(tx)))))))))), signer_ptr, 0)

                if (pkh == headList(sndPair(witness))) {
                    ()
                } else {
                    error()
                }
            } else {
                // witnessed by staking credential in withdrawal
                pair = get_pair(unMapData(headList(tailList(tailList(tailList(tailList(tailList(tailList(tx)))))))), signer_ptr, 0)

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

get_own_hash = (purpose: Data, tx: List[Data]): Data -> {
    purpose_pair = unConstrData(purpose)
    purpose_tag = fstPair(purpose_pair)
    purpose_fields = sndPair(purpose_pair)

    if (purpose_tag == 0) {
        // minting
        headList(purpose_fields)
    } else if (purpose_tag == 1) {
        // spending validator credential
        input = find_input(unListData(headList(tx)), headList(purpose_fields))

        headList(sndPair(unConstrData(headList(sndPair(unConstrData(headList(sndPair(unConstrData(headList(tailList(input)))))))))))
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

find_input = (inputs: List[Data], ref: Data): List[Data] -> {
    input = sndPair(unConstrData(headList(inputs)))

    if (headList(input) == ref) {
        input
    } else {
        find_input(tailList(inputs), ref)
    }
}

get = (inputs: List[Data], index: Int, running_idx: Int): Data -> {
    if (index == running_idx) {
        headList(inputs)
    } else {
        get(inputs, index, addInteger(running_idx, 1))
    }
}

get_pair = (inputs: List[Pair[Data, Data]], index: Int, running_idx: Int): Pair[Data, Data] -> {
    if (index == running_idx) {
        headList(inputs)
    } else {
        get_pair(tailList(inputs), index, addInteger(running_idx, 1))
    }
}

assets_contain = (assets: List[Pair[Data, Data]], policy: Data): Bool -> {
    if (nullList(assets)) {
        false
    } else {
        entry = headList(assets)

        if (fstPair(entry) == policy) {
            true
        } else {
            assets_contain(tailList(assets), policy)
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
